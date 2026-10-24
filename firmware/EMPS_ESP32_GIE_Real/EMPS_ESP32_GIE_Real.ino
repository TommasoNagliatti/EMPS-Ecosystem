/*
  EMPS - ESP32 DevKit V1 - ensaio de LEDs, LCD e WebSocket do GIE.
  Compativel com o contrato emps.energy.v1 da PR #10 (Predio Comercial 13, maquete-01).

  MODO_TESTE_LOCAL = 1 : testa a maquete com cenarios locais, SEM GIE.
  MODO_TESTE_LOCAL = 0 : recebe do backend via WebSocket, SEM calcular energia.

  Padrao SERIAL_ONLY. Ensaio USB exige aprovacao privada local E do backend,
  sessao autorizada, GIE valido e watchdog. Nao habilita recarga comercial fisica.
  NUNCA conectar 127/220 V aos reles neste ensaio.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <Adafruit_NeoPixel.h>
#include <math.h>
#include "segredos_locais.h"
#include "indicadores.h"
#include "reles_usb.h"

#define EMPS_ENERGY_STATION_ID "13"
#define MODO_TESTE_LOCAL 0  // 1 = LEDs/LCD com cenarios de teste; 0 = GIE real via WebSocket
#define LCD_ENDERECO 0x27  // Se seu LCD responde em 0x3F, altere aqui
#define NUM_LEDS_PREDIO 5  // Ajuste para a quantidade REAL de LEDs na sua fita WS2812

// ---- Pinagem informada pelo usuario ----
constexpr uint8_t GPIO_LCD_SDA = 21;
constexpr uint8_t GPIO_LCD_SCL = 22;
constexpr uint8_t GPIO_FITA_PREDIO = 15;
constexpr uint8_t GPIO_SINAL_MEGA = 23;
constexpr uint8_t GPIO_RELE_EV1 = 18;
constexpr uint8_t GPIO_RELE_EV2 = 19;
constexpr uint8_t GPIO_EV1_VERMELHO = 25;
constexpr uint8_t GPIO_EV1_VERDE = 26;
constexpr uint8_t GPIO_EV2_VERMELHO = 27;
constexpr uint8_t GPIO_EV2_VERDE = 32;
constexpr uint8_t GPIO_SOLAR = 33;
constexpr uint8_t GPIO_POSTE = 14;
constexpr uint8_t GPIO_BATERIA[4] = {5, 2, 4, 13};

// Montagem COM + NO confirmada em 24/10/2026. Teste anterior funcional e
// observacao START/STOP confirmaram este modulo como HIGH=ON, LOW=OFF.
// Nunca inverter com carga ligada. Aprovacao privada nao e publicada no Git.
#ifndef EMPS_USB_RELAY_APPROVED
#define EMPS_USB_RELAY_APPROVED 0
#endif
constexpr bool RELES_LIBERADOS = EMPS_USB_RELAY_APPROVED == 1;
constexpr uint8_t RELE_ON = HIGH;
constexpr uint8_t RELE_OFF = LOW;
constexpr const char* RELE_NIVEL_ATIVO = RELE_ON == HIGH ? "HIGH" : "LOW";
static_assert(RELE_ON != RELE_OFF, "Niveis ON/OFF do rele devem ser opostos");
constexpr uint32_t INTERVALO_INDICADORES_MS = 20; // resolves 100 ms pole flashes without blocking WebSocket
constexpr uint32_t INTERVALO_LCD_MS = 3000;
constexpr uint32_t INTERVALO_HEARTBEAT_MS = 2000;
constexpr uint32_t INTERVALO_CENARIO_MS = 8000;
constexpr uint32_t LIMITE_SNAPSHOT_MS = 4000;

LiquidCrystal_I2C lcd(LCD_ENDERECO, 16, 2);
Adafruit_NeoPixel fita(NUM_LEDS_PREDIO, GPIO_FITA_PREDIO, NEO_GRB + NEO_KHZ800);
WebSocketsClient ws;

struct Energia {
  float solar = NAN;
  float redeImport = NAN;
  float redeExport = NAN;
  float bateriaPct = NAN;
  float bateriaCarga = NAN;
  float bateriaDescarga = NAN;
  float predio = NAN;
  float ev1 = NAN;
  float ev2 = NAN;
  float fornecimento = NAN;
  float consumo = NAN;
  bool solarAtiva = false;
  bool ev1GieAutorizado = false;
  bool ev2GieAutorizado = false;
  bool ev1Sessao = false, ev2Sessao = false;
  double ev1ValidadeMs = 0, ev2ValidadeMs = 0;
  bool ev1Operacional = false, ev2Operacional = false;
  bool cenas = false;
  bool demonstracao = false;
  bool demonstracaoValida = false;
  bool ilustrativo = false;
  bool valido = false;
  bool hardwareAprovado = false, eletricaSegura = false;
  bool comandoEv1 = false, comandoEv2 = false;
  double aprovacaoAteMs = 0;
};

Energia energia;
uint32_t ultimaPaginaMs = 0;
uint32_t ultimoIndicadoresMs = 0;
uint32_t ultimoHeartbeatMs = 0;
uint32_t ultimoSnapshotMs = 0;
uint32_t ultimaConexaoWifiMs = 0;
uint32_t ultimaMudancaCenarioMs = 0;
uint32_t relogioServidorMs = 0;
uint32_t ultimoSeq = 0;
uint32_t ultimaRev = 0;
uint8_t pagina = 0;
uint8_t cenario = 0;
uint32_t leaseMs = LIMITE_SNAPSHOT_MS;
uint32_t tempoLocalServidorMs = 0;
uint32_t relogioFaseMs = 0;
uint64_t unusedPlaceholder = 0; // reservado para compatibilidade futura; nao representa medicao
bool wifiJaIniciado = false;
bool wsIniciado = false;
String bootId;
String channelId;
String generation;
String cabecalhos;
String linhaAnterior1;
String linhaAnterior2;
double serverTimeMs = 0;
uint32_t serverSyncMs = 0;
bool releEv1Ativo = false, releEv2Ativo = false;
bool canalUsb = false;
String comandoAplicado;
uint32_t sequenciaAplicada = 0;

void manterRelesDesligados() {
  if (RELES_LIBERADOS) {
    if (releEv1Ativo) digitalWrite(GPIO_RELE_EV1, RELE_OFF);
    if (releEv2Ativo) digitalWrite(GPIO_RELE_EV2, RELE_OFF);
  }
  releEv1Ativo=false; releEv2Ativo=false;
}

void atualizarReles() {
  const double agora=serverTimeMs+(uint32_t)(millis()-serverSyncMs);
  const bool recente=ultimoSnapshotMs && (uint32_t)(millis()-ultimoSnapshotMs)<leaseMs;
  const bool transporte=ws.isConnected() && WiFi.status()==WL_CONNECTED && channelId.length();
  const bool gie=energia.valido && !MODO_TESTE_LOCAL;
  const bool ev1=releUsbPermitido(RELES_LIBERADOS && canalUsb,transporte,recente,
    energia.hardwareAprovado,energia.eletricaSegura,energia.aprovacaoAteMs>agora,energia.cenas,
    gie && energia.ev1GieAutorizado,energia.ev1Sessao,energia.ev1Operacional,energia.ev1ValidadeMs>agora,energia.comandoEv1);
  const bool ev2=releUsbPermitido(RELES_LIBERADOS && canalUsb,transporte,recente,
    energia.hardwareAprovado,energia.eletricaSegura,energia.aprovacaoAteMs>agora,energia.cenas,
    gie && energia.ev2GieAutorizado,energia.ev2Sessao,energia.ev2Operacional,energia.ev2ValidadeMs>agora,energia.comandoEv2);
  // Only transitions write GPIOs; a new energy snapshot never pulses a running relay.
  if (ev1!=releEv1Ativo) { digitalWrite(GPIO_RELE_EV1,ev1?RELE_ON:RELE_OFF); releEv1Ativo=ev1; Serial.printf("[USB] EV1 rele %s\n",ev1?"ON":"OFF"); }
  if (ev2!=releEv2Ativo) { digitalWrite(GPIO_RELE_EV2,ev2?RELE_ON:RELE_OFF); releEv2Ativo=ev2; Serial.printf("[USB] EV2 rele %s\n",ev2?"ON":"OFF"); }
}

void manterPredioLigado() {
  digitalWrite(GPIO_SINAL_MEGA, HIGH);
  // Branco moderado. A fita deve receber energia por fonte 5 V apropriada,
  // NUNCA da saida GPIO do ESP32.
  fita.fill(fita.Color(255, 255, 255));
  fita.show();
}

void limparEnergia() {
  energia = Energia();
}

bool numeroValido(float x) { return isfinite(x) && x >= 0; }

float lerNumero(JsonVariantConst v) {
  if (v.isNull() || v.is<bool>() || v.is<const char*>()) return NAN;
  double x = v.as<double>();
  return (isfinite(x) && x >= 0.0 && x <= 1000000.0) ? (float)x : NAN;
}

uint8_t ledsBateria(float percentual) {
  if (!numeroValido(percentual) || percentual <= 0) return 0;
  if (percentual <= 25) return 1;
  if (percentual <= 50) return 2;
  if (percentual <= 65) return 3;
  return 4;
}

void atualizarLuzes() {
  // Vermelho = sessao existente autorizada, nunca prova de energia fisica.
  const bool ev1Sessao = sessaoIndicada(ultimoSnapshotMs && (uint32_t)(millis()-ultimoSnapshotMs)<leaseMs, energia.ev1Sessao && energia.ev1ValidadeMs > serverTimeMs + (uint32_t)(millis()-serverSyncMs), energia.ev1Operacional);
  const bool ev2Sessao = sessaoIndicada(ultimoSnapshotMs && (uint32_t)(millis()-ultimoSnapshotMs)<leaseMs, energia.ev2Sessao && energia.ev2ValidadeMs > serverTimeMs + (uint32_t)(millis()-serverSyncMs), energia.ev2Operacional);
  const bool ev1Sim = energia.cenas ? energia.valido && numeroValido(energia.ev1) && energia.ev1>0 : ev1Sessao;
  const bool ev2Sim = energia.cenas ? energia.valido && numeroValido(energia.ev2) && energia.ev2>0 : ev2Sessao;
  // Steady color: green available, red active; charger LEDs never blink.
  digitalWrite(GPIO_EV1_VERMELHO, ev1Sim ? HIGH : LOW);
  digitalWrite(GPIO_EV2_VERMELHO, ev2Sim ? HIGH : LOW);
  digitalWrite(GPIO_EV1_VERDE, !ev1Sim ? HIGH : LOW);
  digitalWrite(GPIO_EV2_VERDE, !ev2Sim ? HIGH : LOW);

  // Pole stays on during import, with two brief flashes every five seconds.
  bool importa = (energia.valido || energia.demonstracaoValida) && (energia.ilustrativo || (numeroValido(energia.redeImport) && energia.redeImport > 0.001f));
  digitalWrite(GPIO_POSTE, ledPosteAceso(importa,millis()) ? HIGH : LOW);
  // Independent slow solar blink only while generation is active.
  bool gerando = (energia.valido || energia.demonstracaoValida) && (energia.ilustrativo || (energia.solarAtiva && numeroValido(energia.solar) && energia.solar > 0.001f));
  digitalWrite(GPIO_SOLAR, ledSolarAceso(gerando,millis()) ? HIGH : LOW);

  const uint8_t mascara = mascaraBateria(energia.valido, energia.bateriaPct, energia.bateriaCarga, millis());
  for (int i = 0; i < 4; ++i) digitalWrite(GPIO_BATERIA[i], mascara & (1u << i) ? HIGH : LOW);
  // LEDs have no authority over relay GPIOs. The independent relay controller
  // handles sessions, STOP and watchdog; invalidar() still forces safe OFF.
  digitalWrite(GPIO_SINAL_MEGA, HIGH); // predio sempre ligado, mesmo offline
}

String valorLCD(float x, uint8_t casas = 1) {
  return numeroValido(x) ? String(static_cast<double>(x), static_cast<unsigned int>(casas)) : String("--");
}

String linha16(String valor) {
  if (valor.length() > 16) valor.remove(16);
  while (valor.length() < 16) valor += ' ';
  return valor;
}

void atualizarLCD() {
  String a, b;
  if (!energia.valido && !energia.demonstracaoValida) {
    a = "EMPS SEM DADOS";
    b = MODO_TESTE_LOCAL ? "TESTE AGUARDANDO" : "GIE DESCONECTADO";
  } else {
    switch (pagina % 5) {
      case 0:
        if (energia.ilustrativo) { a="ILUST SOLAR 80%"; b="ILUST REDE 20%"; break; }
        a = (energia.demonstracao ? "DEMO SOL " : "SOLAR ") + valorLCD(energia.solar) + " kW";
        if (numeroValido(energia.redeImport) && energia.redeImport > 0)
          b = "REDE + " + valorLCD(energia.redeImport) + "kW";
        else if (numeroValido(energia.redeExport) && energia.redeExport > 0)
          b = "REDE - " + valorLCD(energia.redeExport) + "kW";
        else b = numeroValido(energia.redeImport) && numeroValido(energia.redeExport) ? "REDE 0.0 kW" : "REDE -- kW";
        break;
      case 1:
        a = "BATERIA " + valorLCD(energia.bateriaPct, 0) + "%";
        if (numeroValido(energia.bateriaCarga) && energia.bateriaCarga > 0)
          b = "CARGA " + valorLCD(energia.bateriaCarga) + " kW";
        else if (numeroValido(energia.bateriaDescarga) && energia.bateriaDescarga > 0)
          b = "DESC. " + valorLCD(energia.bateriaDescarga) + " kW";
        else b = "BAT ESTAVEL";
        break;
      case 2:
        a = "EV1 " + valorLCD(energia.ev1) + " kW SIM";
        b = "EV2 " + valorLCD(energia.ev2) + " kW SIM";
        break;
      case 3:
        a = "PREDIO " + valorLCD(energia.predio) + " kW";
        b = "LUZES LIGADAS";
        break;
      default:
        a = "FORN " + valorLCD(energia.fornecimento) + " kW";
        b = "CONS " + valorLCD(energia.consumo) + " kW";
        break;
    }
  }
  a = linha16(a);
  b = linha16(b);
  if (a != linhaAnterior1 || b != linhaAnterior2) {
    lcd.setCursor(0, 0); lcd.print(a);
    lcd.setCursor(0, 1); lcd.print(b);
    linhaAnterior1 = a;
    linhaAnterior2 = b;
  }
}

void mostrarResumo(const char* origem) {
  Serial.printf("[%s] Solar %.2fkW | Rede +%.2f/ -%.2fkW | Predio %.2f | Bat %.0f%% C%.2f D%.2f | EV1 %.2f EV2 %.2f | reles %d/%d\n",
      origem, energia.solar, energia.redeImport, energia.redeExport, energia.predio,
      energia.bateriaPct, energia.bateriaCarga, energia.bateriaDescarga, energia.ev1, energia.ev2,releEv1Ativo,releEv2Ativo);
}

void carregarCenarioDeTeste(uint8_t qual) {
  limparEnergia();
  energia.valido = true;
  energia.predio = 5;
  energia.ev1GieAutorizado = true;
  energia.ev2GieAutorizado = true;
  switch (qual % 5) {
    case 0:  // solar + rede + bateria 25%
      energia.solar=6; energia.solarAtiva=true; energia.redeImport=3; energia.redeExport=0;
      energia.ev1=4; energia.ev2=0; energia.bateriaPct=25; energia.bateriaCarga=0; energia.bateriaDescarga=0;
      break; // forn 9 = consumo 5+4
    case 1:  // sem solar; rede alimenta EV1
      energia.solar=0; energia.solarAtiva=false; energia.redeImport=12; energia.redeExport=0;
      energia.ev1=7; energia.ev2=0; energia.bateriaPct=50; energia.bateriaCarga=0; energia.bateriaDescarga=0;
      break; // forn 12 = consumo 5+7
    case 2:  // solar alimenta predio, EV2 e carrega bateria
      energia.solar=13; energia.solarAtiva=true; energia.redeImport=0; energia.redeExport=0;
      energia.ev1=0; energia.ev2=5; energia.bateriaPct=75; energia.bateriaCarga=3; energia.bateriaDescarga=0;
      break; // forn 13 = consumo 5+5+3
    case 3:  // bateria descarrega e suporta ambos os carregadores
      energia.solar=4; energia.solarAtiva=true; energia.redeImport=0; energia.redeExport=0;
      energia.ev1=3; energia.ev2=4; energia.bateriaPct=100; energia.bateriaCarga=0; energia.bateriaDescarga=8;
      break; // forn 4+8 = consumo 5+3+4
    default: // exportacao para a rede
      energia.solar=10; energia.solarAtiva=true; energia.redeImport=0; energia.redeExport=5;
      energia.ev1=0; energia.ev2=0; energia.bateriaPct=90; energia.bateriaCarga=0; energia.bateriaDescarga=0;
      break; // forn 10 = consumo 5+export 5
  }
  energia.fornecimento=energia.solar+energia.redeImport+energia.bateriaDescarga;
  energia.consumo=energia.predio+energia.ev1+energia.ev2+energia.bateriaCarga+energia.redeExport;
  mostrarResumo("TESTE LOCAL - NAO GIE");
  atualizarLuzes();
  atualizarLCD();
}

void mandarMensagem(const char* tipo, const char* id=nullptr, uint32_t seq=0, bool aceito=false) {
  if (!ws.isConnected()) return;
  JsonDocument m;
  m["type"] = tipo;
  m["stationId"] = EMPS_ENERGY_STATION_ID;
  m["bootId"] = bootId;
  if (channelId.length()) m["channelId"] = channelId;
  if (String(tipo) == "hello") {
    if (RELES_LIBERADOS) {
      m["relayCapability"]="emps.usb-relay.v1";
      m["relayActiveLevel"]=RELE_NIVEL_ATIVO;
    }
  } else {
    m["ev1"] = releEv1Ativo; // GPIO commanded, never physical metering
    m["ev2"] = releEv2Ativo;
    if (!id && comandoAplicado.length()) { m["commandId"]=comandoAplicado; m["sequence"]=sequenciaAplicada; }
  }
  if (id) {
    m["commandId"] = id;
    m["sequence"] = seq;
    m["accepted"] = aceito;
  }
  String saida;
  serializeJson(m, saida);
  ws.sendTXT(saida);
}

void invalidar(const char* motivo) {
  limparEnergia();
  manterRelesDesligados();
  atualizarLuzes();
  atualizarLCD();
  Serial.printf("[GIE] %s. Energia indisponivel, EVs verdes, reles sem acionamento, predio ligado.\n", motivo);
}

void desconectarInvalido(const char* motivo) {
  invalidar(motivo);
  ws.disconnect();
}

bool textoIgual(JsonVariantConst v, const char* texto) {
  return v.is<const char*>() && strcmp(v.as<const char*>(), texto) == 0;
}

void processarSnapshot(JsonDocument& d) {
  JsonVariantConst s = d.as<JsonVariantConst>();
  const uint32_t seq = s["sequence"].as<uint32_t>();
  const String cmd = s["commandId"].as<String>();
  double expira = s["expiresAtMs"].as<double>();
  double enviado = s["emittedAtMs"].as<double>();
  double agoraEstimado = serverTimeMs + (uint32_t)(millis() - serverSyncMs);
  JsonVariantConst ev1 = s["evses"]["EV1"];
  JsonVariantConst ev2 = s["evses"]["EV2"];
  const bool usb=canalUsb && RELES_LIBERADOS && textoIgual(s["mode"],"USB_RELAY_TEST") &&
    s["hardwareApproved"]==true && s["electricalSafe"]==true &&
    textoIgual(s["relayApproval"]["scope"],"LOW_VOLTAGE_USB_ONLY") &&
    textoIgual(s["relayApproval"]["activeLevel"],RELE_NIVEL_ATIVO);
  const bool serial=textoIgual(s["mode"],"SERIAL_ONLY") &&
    s["hardwareApproved"]==false && s["electricalSafe"]==false &&
    ev1["effectiveRelay"]==false && ev2["effectiveRelay"]==false;

  if (!textoIgual(s["schemaVersion"], "emps.energy.v1") ||
      !textoIgual(s["stationId"], EMPS_ENERGY_STATION_ID) ||
      !textoIgual(s["bootId"], bootId.c_str()) ||
      !textoIgual(s["channelId"], channelId.c_str()) ||
      (!usb && !serial) ||
      !textoIgual(s["source"], "SIMULATED") ||
      !s["hardwareApproved"].is<bool>() ||
      !s["electricalSafe"].is<bool>() ||
      !s["physicalMeasurement"].is<bool>() || s["physicalMeasurement"].as<bool>() ||
      !ev1["effectiveRelay"].is<bool>() ||
      !ev2["effectiveRelay"].is<bool>() ||
      seq == 0 || seq <= ultimoSeq || cmd.length() != 36 ||
      s["ttlMs"].as<uint32_t>() != LIMITE_SNAPSHOT_MS ||
      s["expiresAtMs"].isNull() || s["emittedAtMs"].isNull() ||
      (expira - enviado) < 3999 || (expira - enviado) > 4001 ||
      expira <= agoraEstimado || enviado > agoraEstimado + 1000) {
    desconectarInvalido("Snapshot com identidade, validade ou permissao invalida");
    return;
  }

  ultimoSeq = seq;
  bool valido = s["valid"].is<bool>() && s["valid"].as<bool>();
  if (valido) {
    String novaGeracao = s["generation"].as<String>();
    uint32_t novaRevisao = s["revision"].as<uint32_t>();
    if (novaGeracao.length() == 0 || s["revision"].isNull() ||
        (generation == novaGeracao && novaRevisao < ultimaRev)) valido = false;
    else {
      generation = novaGeracao;
      ultimaRev = novaRevisao;
    }
  }

  if (valido) {
    Energia e;
    e.solar=lerNumero(s["solar"]["generatedKw"]);
    e.solarAtiva=s["solar"]["active"].is<bool>() && s["solar"]["active"].as<bool>();
    e.redeImport=lerNumero(s["grid"]["importKw"]);
    e.redeExport=lerNumero(s["grid"]["exportKw"]);
    e.bateriaPct=lerNumero(s["battery"]["socMeanPct"]);
    if (numeroValido(e.bateriaPct) && e.bateriaPct > 100) e.bateriaPct=NAN;
    e.bateriaCarga=lerNumero(s["battery"]["chargeKw"]);
    e.bateriaDescarga=lerNumero(s["battery"]["dischargeKw"]);
    e.predio=lerNumero(s["building"]["consumptionKw"]);
    e.ev1=lerNumero(ev1["allocatedKw"]);
    e.ev2=lerNumero(ev2["allocatedKw"]);
    e.ev1ValidadeMs=ev1["sessionExpiresAtMs"].as<double>();
    e.ev2ValidadeMs=ev2["sessionExpiresAtMs"].as<double>();
    e.ev1Sessao=ev1["sessionAuthorized"].is<bool>() && ev1["sessionAuthorized"].as<bool>();
    e.ev2Sessao=ev2["sessionAuthorized"].is<bool>() && ev2["sessionAuthorized"].as<bool>();
    e.ev1Operacional=ev1["operationalAuthorized"].is<bool>() && ev1["operationalAuthorized"].as<bool>();
    e.ev2Operacional=ev2["operationalAuthorized"].is<bool>() && ev2["operationalAuthorized"].as<bool>();
    e.ev1GieAutorizado=ev1["gieAuthorized"].as<bool>();
    e.ev2GieAutorizado=ev2["gieAuthorized"].as<bool>();
    e.fornecimento=lerNumero(s["balance"]["supplyKw"]);
    e.consumo=lerNumero(s["balance"]["consumptionKw"]);
    e.ilustrativo=s["presentation"]["gieMode"]=="NORMAL" && s["presentation"]["source"]=="ILLUSTRATIVE_ONLY";
    e.valido=true;
    energia=e;
    mostrarResumo("GIE WEB SOCKET - SIMULADO");
  } else {
    limparEnergia();
    Serial.println("[GIE] Snapshot marcado como INDISPONIVEL pelo backend");
  }
  energia.cenas=s["presentation"]["gieMode"]=="PRESENTATION";
  if(s["presentation"]["gieMode"]=="CHARGER_DEMO" && s["maqueteDisplay"]["version"]=="CHARGER_DEMO_ILLUSTRATION_V1") {
    JsonVariantConst d=s["maqueteDisplay"];
    energia.demonstracao=true;energia.ilustrativo=false;
    energia.solar=lerNumero(d["solarPowerKw"]);energia.solarAtiva=energia.solar>0;
    float rede=d["gridPowerKw"].as<float>();
    energia.redeImport=rede>0?rede:0;energia.redeExport=rede<0?-rede:0;
    energia.predio=lerNumero(d["buildingPowerKw"]);
    energia.ev1=lerNumero(d["EV1"]);energia.ev2=lerNumero(d["EV2"]);
    energia.bateriaCarga=0;energia.bateriaDescarga=0;
    energia.fornecimento=energia.solar+energia.redeImport;
    energia.consumo=energia.predio+lerNumero(d["chargerPowerKw"])+energia.redeExport;
    energia.demonstracaoValida = d["provenance"]=="SIMULATED" &&
      numeroValido(energia.solar) && numeroValido(energia.predio) &&
      d["gridPowerKw"].is<double>() && isfinite(rede) &&
      numeroValido(energia.ev1) && numeroValido(energia.ev2) &&
      numeroValido(energia.consumo) &&
      fabs(energia.fornecimento-energia.consumo)<0.001f;

  }
  // Operational state is independently authenticated by the frame; scenes cannot stop a session.
  energia.ev1Sessao=ev1["sessionAuthorized"].is<bool>() && ev1["sessionAuthorized"].as<bool>();
  energia.ev2Sessao=ev2["sessionAuthorized"].is<bool>() && ev2["sessionAuthorized"].as<bool>();
  energia.ev1Operacional=ev1["operationalAuthorized"].is<bool>() && ev1["operationalAuthorized"].as<bool>();
  energia.ev2Operacional=ev2["operationalAuthorized"].is<bool>() && ev2["operationalAuthorized"].as<bool>();
  energia.ev1ValidadeMs=ev1["sessionExpiresAtMs"].as<double>();
  energia.ev2ValidadeMs=ev2["sessionExpiresAtMs"].as<double>();
  energia.hardwareAprovado=usb;
  energia.eletricaSegura=usb;
  energia.aprovacaoAteMs=usb ? s["relayApproval"]["expiresAtMs"].as<double>() : 0;
  energia.comandoEv1=usb && ev1["effectiveRelay"]==true &&
    textoIgual(ev1["chargerCode"],"CH-f2f059af5117b95fb970");
  energia.comandoEv2=usb && ev2["effectiveRelay"]==true &&
    textoIgual(ev2["chargerCode"],"CH-26f5af4e137bbe735ed5");
  ultimoSnapshotMs=millis();
  leaseMs=(uint32_t)(expira-agoraEstimado);
  if (leaseMs>LIMITE_SNAPSHOT_MS) leaseMs=LIMITE_SNAPSHOT_MS;
  comandoAplicado=cmd; sequenciaAplicada=seq;
  atualizarReles();
  mandarMensagem("ack", cmd.c_str(), seq, valido);
  atualizarLuzes();
  atualizarLCD();
}

void eventoWS(WStype_t tipo, uint8_t* payload, size_t tamanho) {
  if (tipo == WStype_DISCONNECTED) {
    canalUsb=false;
    channelId="";
    ultimoSnapshotMs=0;
    invalidar("WebSocket desconectado");
    return;
  }
  if (tipo == WStype_CONNECTED) {
    canalUsb=false;
    comandoAplicado="";
    channelId="";
    ultimoSeq=0;
    ultimaRev=0;
    generation="";
    ultimoSnapshotMs=0;
    invalidar("WebSocket conectado: aguardando welcome");
    mandarMensagem("hello");
    return;
  }
  if (tipo != WStype_TEXT) return;
  if (tamanho > 16384) { desconectarInvalido("JSON grande demais"); return; }
  JsonDocument doc;
  if (deserializeJson(doc,payload,tamanho)) { desconectarInvalido("JSON invalido"); return; }
  JsonVariantConst d=doc.as<JsonVariantConst>();
  if (textoIgual(d["type"], "welcome")) {
    if (!textoIgual(d["stationId"], EMPS_ENERGY_STATION_ID) ||
        !textoIgual(d["deviceId"], "maquete-01") ||
        !(textoIgual(d["mode"], "SERIAL_ONLY") || (RELES_LIBERADOS && textoIgual(d["mode"],"USB_RELAY_TEST"))) ||
        !d["channelId"].is<const char*>() || d["serverTimeMs"].isNull()) {
      desconectarInvalido("Welcome invalido"); return;
    }
    channelId=d["channelId"].as<String>();
    canalUsb=RELES_LIBERADOS && textoIgual(d["mode"],"USB_RELAY_TEST");
    serverTimeMs=d["serverTimeMs"].as<double>();
    serverSyncMs=millis();
    ultimoHeartbeatMs=millis();
    Serial.printf("[WS] Sessao aceita, canal: %s\n", channelId.c_str());
    mandarMensagem("heartbeat");
    return;
  }
  if (textoIgual(d["type"], "energy.snapshot") && channelId.length()) processarSnapshot(doc);
  else desconectarInvalido("Mensagem desconhecida do servidor");
}

void iniciarWebSocket() {
  if (wsIniciado) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (strlen(EMPS_DEVICE_TOKEN) < 32 || String(EMPS_DEVICE_TOKEN).startsWith("COLE_") ||
      String(EMPS_BRIDGE_IP).startsWith("COLOQUE_")) {
    Serial.println("[CONFIG] Preencha EMPS_DEVICE_TOKEN e EMPS_BRIDGE_IP em segredos_locais.h");
    return;
  }
  cabecalhos=String("X-Device-Token: ")+EMPS_DEVICE_TOKEN+"\r\nX-Station-Id: " + String(EMPS_ENERGY_STATION_ID);
  ws.begin(EMPS_BRIDGE_IP, 3012, "/devices/maquete-01/energy/ws");
  ws.setExtraHeaders(cabecalhos.c_str());
  ws.onEvent(eventoWS);
  ws.setReconnectInterval(3000);
  wsIniciado=true;
  Serial.printf("[WS] Abrindo ws://%s:3012/...\n", EMPS_BRIDGE_IP);
}

void manterWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiJaIniciado) {
      Serial.printf("[WIFI] CONECTADO: IP ESP32 = %s | RSSI %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      wifiJaIniciado=true;
    }
    return;
  }
  if (wifiJaIniciado) {
    wifiJaIniciado=false;
    invalidar("Wi-Fi caiu");
  }
  if (millis()-ultimaConexaoWifiMs>15000 || ultimaConexaoWifiMs==0) {
    ultimaConexaoWifiMs=millis();
    Serial.printf("[WIFI] Tentando conectar a %s...\n", EMPS_WIFI_SSID);
    WiFi.disconnect();
    WiFi.begin(EMPS_WIFI_SSID, EMPS_WIFI_PASS);
  }
}

void setup() {
  // Establish inactive level before Serial, delays or network initialization.
  // External bias must hold this same inactive level during reset/boot.
  if (RELES_LIBERADOS) {
    digitalWrite(GPIO_RELE_EV1,RELE_OFF); digitalWrite(GPIO_RELE_EV2,RELE_OFF);
    pinMode(GPIO_RELE_EV1,OUTPUT); pinMode(GPIO_RELE_EV2,OUTPUT);
  } else {
    pinMode(GPIO_RELE_EV1, INPUT); pinMode(GPIO_RELE_EV2, INPUT);
  }
  Serial.begin(115200);
  delay(300);
  Serial.println("\n===== EMPS | ESP32 MAQUETE =====");
  Serial.println(MODO_TESTE_LOCAL ? "MODO: TESTE LOCAL (NAO GIE)" : "MODO: GIE WEBSOCKET (SIMULADO)");

  Serial.printf("[USB] EV1 GPIO18 / EV2 GPIO19: ON=%s, OFF=%s; COM+NO\n",RELE_NIVEL_ATIVO,RELE_OFF==LOW?"LOW":"HIGH");

  manterRelesDesligados();

  const uint8_t pinos[] = {GPIO_SINAL_MEGA, GPIO_EV1_VERMELHO, GPIO_EV1_VERDE,
    GPIO_EV2_VERMELHO, GPIO_EV2_VERDE, GPIO_SOLAR, GPIO_POSTE};
  for (uint8_t p : pinos) { pinMode(p,OUTPUT); digitalWrite(p,LOW); }
  for (uint8_t p : GPIO_BATERIA) {pinMode(p,OUTPUT);digitalWrite(p,LOW);}
  digitalWrite(GPIO_SINAL_MEGA,HIGH);

  fita.begin();
  fita.setBrightness(45);
  manterPredioLigado();

  Wire.begin(GPIO_LCD_SDA,GPIO_LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0,0);lcd.print("EMPS INICIANDO");
  lcd.setCursor(0,1);lcd.print("ESP32 + GIE");
  Serial.println("[LCD] I2C SDA21/SCL22; esperado 0x27");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  ultimaConexaoWifiMs=millis();
  WiFi.begin(EMPS_WIFI_SSID, EMPS_WIFI_PASS);
  Serial.printf("[WIFI] Conectando a %s (2,4 GHz)...\n",EMPS_WIFI_SSID);

  bootId="esp_"+String((uint32_t)esp_random(),HEX)+String((uint32_t)esp_random(),HEX);
  ultimoIndicadoresMs=millis();
  ultimaPaginaMs=millis();
  ultimaMudancaCenarioMs=millis();
  limparEnergia();
  if (MODO_TESTE_LOCAL) carregarCenarioDeTeste(cenario);
  else invalidar("Aguardando GIE");
}

void loop() {
  manterWiFi();
  if (!MODO_TESTE_LOCAL) {
    if (WiFi.status()==WL_CONNECTED) iniciarWebSocket();
    if (wsIniciado) ws.loop();
    if (ultimoSnapshotMs && (uint32_t)(millis()-ultimoSnapshotMs)>=leaseMs) {
      ultimoSnapshotMs=0;
      invalidar("Snapshot expirou (>4s)");
    }
    if (channelId.length() && millis()-ultimoHeartbeatMs >= INTERVALO_HEARTBEAT_MS) {
      ultimoHeartbeatMs=millis();
      mandarMensagem("heartbeat");
    }
  } else if (millis()-ultimaMudancaCenarioMs>=INTERVALO_CENARIO_MS) {
    ultimaMudancaCenarioMs=millis();
    cenario=(cenario+1)%5;
    carregarCenarioDeTeste(cenario);
  }

  if (millis()-ultimoIndicadoresMs>=INTERVALO_INDICADORES_MS) {
    ultimoIndicadoresMs=millis();
    atualizarLuzes();
  }
  if (millis()-ultimaPaginaMs>=INTERVALO_LCD_MS) {
    ultimaPaginaMs=millis();
    pagina=(pagina+1)%5;
    atualizarLCD();
  }
  atualizarReles();
  digitalWrite(GPIO_SINAL_MEGA,HIGH);
  delay(5);
}
