#ifndef EMPS_ENERGY_STATION_ID
#define EMPS_ENERGY_STATION_ID "46"
#endif
#pragma once
// Included after the existing display/safe-stop functions. RFC6455, not Socket.IO.
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#if EMPS_HABILITAR_RELES
#error Esta etapa e SERIAL_ONLY. Liberacao eletrica exige validacao e aprovacao especificas.
#endif
WebSocketsClient energySocket;
String energyHeaders, energyChannel, energyGeneration;
uint32_t energySequence = 0, energyRevision = 0, energyReceivedMs = 0, energyHeartbeatMs = 0;
bool energyStarted = false;
double energyServerTimeMs = 0;
uint32_t energyClockStartMs = 0;
uint32_t energyLeaseMs = 0;

void energyOff(const char* reason) {
  desligarPorFalha(reason);
  predioKw = ev1GieKw = ev2GieKw = redeExportKw = -1;
  energyReceivedMs = 0;
  alterarLuz(false, true, reason);
}
void energySend(const char* type, const char* commandId = nullptr, uint32_t sequence = 0, bool accepted = false) {
  JsonDocument message;
  message["type"]=type; message["stationId"]=EMPS_ENERGY_STATION_ID; message["bootId"]=bootId;
  message["channelId"]=energyChannel; message["ev1"]=false; message["ev2"]=false;
  if(commandId){message["commandId"]=commandId;message["sequence"]=sequence;message["accepted"]=accepted;}
  String wire; serializeJson(message,wire); energySocket.sendTXT(wire);
}
float energyNumber(JsonVariantConst value) {
  if(!value.is<float>()) return -1;
  const float n=value.as<float>(); return isfinite(n) && n>=0 ? n : -1;
}
void energyEvent(WStype_t type, uint8_t* payload, size_t length) {
  if(type==WStype_DISCONNECTED){energyChannel="";energyOff("WS_OFFLINE");return;}
  if(type==WStype_CONNECTED){energyChannel="";energySequence=0;energyGeneration="";energyRevision=0;energyOff("WS_CONNECT");energySend("hello");return;}
  if(type!=WStype_TEXT) return;
  JsonDocument d;
  if(length>12000 || deserializeJson(d,payload,length)){energyOff("JSON_INVALIDO");energySocket.disconnect();return;}
  if(d["type"]=="welcome"){
    if(d["stationId"]!=EMPS_ENERGY_STATION_ID || d["deviceId"]!=EMPS_DEVICE_ID || d["mode"]!="SERIAL_ONLY" || !d["channelId"].is<const char*>()){
      energyOff("IDENTIDADE_INVALIDA");energySocket.disconnect();return;
    }
    if(!d["serverTimeMs"].is<double>()){energySocket.disconnect();return;}
    energyServerTimeMs=d["serverTimeMs"].as<double>();energyClockStartMs=millis();
    energyChannel=d["channelId"].as<String>(); energyHeartbeatMs=millis();energySend("heartbeat");return;
  }
  if(d["type"]!="energy.snapshot" || d["schemaVersion"]!="emps.energy.v1" || d["stationId"]!=EMPS_ENERGY_STATION_ID ||
      d["channelId"].as<String>()!=energyChannel || energyChannel.length()==0 || d["bootId"].as<String>()!=bootId ||
      !d["sequence"].is<uint32_t>() || d["sequence"].as<uint32_t>()<=energySequence ||
      d["ttlMs"]!=4000 || (!d["commandId"].is<const char*>() || !idValido(d["commandId"].as<String>())) || d["source"]!="SIMULATED" ||
      !d["expiresAtMs"].is<double>() || !d["emittedAtMs"].is<double>() ||
      d["expiresAtMs"].as<double>()-d["emittedAtMs"].as<double>()!=4000 ||
      d["expiresAtMs"].as<double>()<=energyServerTimeMs+(uint32_t)(millis()-energyClockStartMs) ||
      d["emittedAtMs"].as<double>()>energyServerTimeMs+(uint32_t)(millis()-energyClockStartMs)+1000 ||
      d["mode"]!="SERIAL_ONLY" || !d["physicalMeasurement"].is<bool>() || d["physicalMeasurement"].as<bool>() ||
      !d["hardwareApproved"].is<bool>() || d["hardwareApproved"].as<bool>() ||
      !d["evses"]["EV1"]["effectiveRelay"].is<bool>() || d["evses"]["EV1"]["effectiveRelay"].as<bool>() ||
      !d["evses"]["EV2"]["effectiveRelay"].is<bool>() || d["evses"]["EV2"]["effectiveRelay"].as<bool>()) {
    energyOff("FRAME_REJEITADO");energySocket.disconnect();return;
  }
  energySequence=d["sequence"].as<uint32_t>();
  bool valid=d["valid"].is<bool>() && d["valid"].as<bool>();
  if(valid){
    const String generation=d["generation"].as<String>();
    if(!d["revision"].is<uint32_t>() || generation.length()==0 ||
        (generation==energyGeneration && d["revision"].as<uint32_t>()<energyRevision)) valid=false;
    else {energyGeneration=generation;energyRevision=d["revision"].as<uint32_t>();}
  }
  if(valid){
    solarKw=energyNumber(d["solar"]["generatedKw"]);solarInformado=solarKw>=0;
    redeKw=energyNumber(d["grid"]["importKw"]);redeInformada=redeKw>=0;
    redeExportKw=energyNumber(d["grid"]["exportKw"]);
    predioKw=energyNumber(d["building"]["consumptionKw"]);
    ev1GieKw=energyNumber(d["evses"]["EV1"]["allocatedKw"]);
    ev2GieKw=energyNumber(d["evses"]["EV2"]["allocatedKw"]);
    bat1Pct=energyNumber(d["battery"]["BAT_01"]["socPct"]); if(bat1Pct>100)bat1Pct=-1;
    bat2Pct=energyNumber(d["battery"]["BAT_02"]["socPct"]); if(bat2Pct>100)bat2Pct=-1;
    cenarioGieExibido=d["scenarioAt"].as<String>();
    aplicarBarrasBateria("GIE_WS_SIMULATED");
    alterarLuz(true,redeInformada && redeKw>0,"GIE_WS");
    ultimaConsultaBemSucedidaMs=ultimoSnapshotMs=energyReceivedMs=millis();
    energyLeaseMs=(uint32_t)(d["expiresAtMs"].as<double>()-(energyServerTimeMs+(uint32_t)(millis()-energyClockStartMs)));
    if(energyLeaseMs>4000)energyLeaseMs=4000;
  } else energyOff("GIE_INDISPONIVEL");
  // No call to alterarEV(true), even when session + GIE authorize charging.
  // SERIAL_ONLY: boot/fault handling owns relay blocking; energy snapshots never drive GPIOs.
  alterarLuz(false,true,"PREDIO_FIXO");
  Serial.printf("[GIE_WS SIMULATED] seq=%lu rev=%lu valid=%d solar=%.2f rede=%.2f predio=%.2f EV1=%.2f EV2=%.2f SOC=%.1f/%.1f RELES=BLOQUEADOS\n",
    (unsigned long)energySequence,(unsigned long)energyRevision,valid,solarInformado?solarKw:-1,redeInformada?redeKw:-1,predioKw,ev1GieKw,ev2GieKw,bat1Pct,bat2Pct);
  energySend("ack",d["commandId"],energySequence,valid);atualizarLCD();
}
void energyLoop() {
  if(!energyStarted){
    String base=EMPS_SERVER_BASE;
    if(!base.startsWith("http://")){energyOff("PONTE_LOCAL_HTTP_NECESSARIA");return;}
    base.remove(0,7); const int colon=base.indexOf(':');
    if(colon<1){energyOff("PORTA_PONTE_AUSENTE");return;}
    const String host=base.substring(0,colon); const uint16_t port=base.substring(colon+1).toInt();
    if(port!=3012){energyOff("PORTA_PONTE_INVALIDA");return;}
    // WebSocketsClient adds the final CRLF itself; an extra one ends HTTP headers early.
    energyHeaders=String("X-Device-Token: ")+EMPS_DEVICE_TOKEN+"\r\nX-Station-Id: " + String(EMPS_ENERGY_STATION_ID);
    energySocket.begin(host.c_str(),port,"/devices/maquete-01/energy/ws","");
    energySocket.setExtraHeaders(energyHeaders.c_str());energySocket.onEvent(energyEvent);
    energySocket.setReconnectInterval(3000);energyStarted=true;
  }
  energySocket.loop();
  if(energyChannel.length() && millis()-energyHeartbeatMs>=2000){energyHeartbeatMs=millis();energySend("heartbeat");}
  if(energyReceivedMs && millis()-energyReceivedMs>=energyLeaseMs) energyOff("SNAPSHOT_EXPIRADO");
}
