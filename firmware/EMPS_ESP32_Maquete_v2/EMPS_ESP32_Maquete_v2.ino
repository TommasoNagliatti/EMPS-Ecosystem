/*
  EMPS | Maquete de recarga - ESP32 DevKit V1
  - Dois EVSEs com rele ativo em LOW (LOW=energizado, HIGH=desligado).
  - LED vermelho pisca durante recarga; verde aceso quando disponivel.
  - Quatro LEDs de nivel de bateria, luz do poste e luzes do predio.
  - Interface Serial para teste SEM equipamento instalado.
  - Interface futura por polling HTTP/HTTPS do Backend (nunca do MySQL).
  - LCD 16x2 com telas rotativas: recarga, rede, solar, baterias, iluminacao e estacao.
  - RC522 opcional: anuncia RFID, sem liberar rele sem autorizacao.
  - Dados energeticos do GIE sao SIMULADOS, nao medicoes fisicas de USB.
  IMPORTANTE: NAO COMUTAR REDE 127/220 V. Usar apenas baixa tensao USB
  com circuito isolado/limitado e protecao contra falhas.
*/

#include <Arduino.h>
#include <ctype.h>
#include <math.h>
#include <stdlib.h>

// 0 conserva o ensaio por Serial sem energizar uma montagem nao verificada.
// Para a ponte local, compile com EMPS_USAR_WIFI=1 apos conferir a fiacao.
#ifndef EMPS_USAR_WIFI
#define EMPS_USAR_WIFI 0
#endif
#ifndef EMPS_USAR_LCD
#define EMPS_USAR_LCD 0
#endif
#ifndef EMPS_USAR_RFID
#define EMPS_USAR_RFID 0
#endif
// Modo de diagnostico: comunicacao e LCD podem ser testados sem fechar reles.
// Habilite 1 somente depois de conferir a montagem USB e o corte externo.
#ifndef EMPS_HABILITAR_RELES
#define EMPS_HABILITAR_RELES 0
#endif
#if EMPS_HABILITAR_RELES && !EMPS_USAR_WIFI
  #error Reles exigem Wi-Fi e comandos autenticados do Backend; Serial isolado nao pode iniciar recarga.
#endif

#if EMPS_USAR_WIFI
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WiFiClientSecure.h>
  #include "segredos_locais.h"  // Arquivo PRIVADO, nao subir ao Git.
#endif
#if EMPS_USAR_LCD
  #include <Wire.h>
  #include <LiquidCrystal_I2C.h>
#endif
#if EMPS_USAR_RFID
  #include <SPI.h>
  #include <MFRC522.h>
#endif

// Pinagem EXATAMENTE como a definida para a maquete.
constexpr uint8_t PIN_BAT[] = {16, 17, 18, 19};
constexpr uint8_t PIN_EV1_VERMELHO = 25;
constexpr uint8_t PIN_EV1_VERDE = 26;
constexpr uint8_t PIN_EV2_VERMELHO = 27;
constexpr uint8_t PIN_EV2_VERDE = 32;
constexpr uint8_t PIN_RELE_EV1 = 15;
constexpr uint8_t PIN_RELE_EV2 = 33;
constexpr uint8_t PIN_POSTE = 13;
constexpr uint8_t PIN_PREDIO = 14;
constexpr uint8_t PIN_LCD_SDA = 21;
constexpr uint8_t PIN_LCD_SCL = 22;
constexpr uint8_t PIN_RFID_SS = 5;
constexpr uint8_t PIN_RFID_SCK = 12;
constexpr uint8_t PIN_RFID_MOSI = 23;
constexpr uint8_t PIN_RFID_MISO = 34;
constexpr uint8_t PIN_RFID_RST = 4;

// Foi confirmado no modulo de rele testado: 0 fecha, 1 abre.
constexpr uint8_t RELE_LIGADO = LOW;
constexpr uint8_t RELE_DESLIGADO = HIGH;
constexpr unsigned long INTERVALO_PISCA_MS = 450;
constexpr unsigned long INTERVALO_LCD_MS = 3200;
constexpr unsigned long TEMPO_MAX_SEM_BACKEND_MS = 8000;
constexpr const char* VERSAO_FIRMWARE = "EMPS_ESP32_Maquete_v2.1-local";
constexpr const char* ESTACAO_LOCAL_ID = "46";

bool ev1Carregando = false;
bool ev2Carregando = false;
bool posteLigado = false;
bool predioLigado = true;
float predioKw = -1, ev1GieKw = -1, ev2GieKw = -1, redeExportKw = -1;
uint8_t niveisBateria = 0;
bool faseVermelho = false;
unsigned long ultimoPiscaMs = 0;
String entradaSerial;
// Valores do GIE, nunca confundidos com leituras reais do USB.
bool redeInformada = false;
bool solarInformado = false;
float redeKw = 0;
float solarKw = 0;
float bat1Pct = -1;  // -1: sem leitura/bateria ausente
float bat2Pct = -1;
bool bateriaConfirmadaAusente = false;  // distingue sem bateria de SoC ainda nao recebido
String estacaoExibida = "POSTO 24H";
String cenarioGieExibido;
String avisoLinha1;
String avisoLinha2;
unsigned long avisoExpiraMs = 0;
uint8_t paginaLCD = 0;
unsigned long ultimaTrocaPaginaMs = 0;
String ultimaLinhaLCD1;
String ultimaLinhaLCD2;

#if EMPS_USAR_LCD
LiquidCrystal_I2C* lcd = nullptr;
#endif
#if EMPS_USAR_RFID
MFRC522 leitor(PIN_RFID_SS, PIN_RFID_RST);
#endif
#if EMPS_USAR_WIFI
unsigned long ultimaTentativaWifiMs = 0;
unsigned long ultimaConsultaMs = 0;
unsigned long ultimoHeartbeatMs = 0;
unsigned long ultimaConsultaBemSucedidaMs = 0;
unsigned long ultimoSnapshotMs = 0;
String ultimoIdComando;
String bootId;
bool enderecoWifiInformado = false;
String idsAplicados[8];
String acoesAplicadas[8];
uint8_t proximoIdAplicado = 0;
constexpr unsigned long INTERVALO_CONSULTA_MS = 1200;
constexpr unsigned long INTERVALO_HEARTBEAT_MS = 5000;
#endif

bool backendDisponivel() {
#if EMPS_USAR_WIFI
  return WiFi.status() == WL_CONNECTED && ultimaConsultaBemSucedidaMs != 0 && ultimoSnapshotMs != 0 &&
    millis() - ultimaConsultaBemSucedidaMs <= TEMPO_MAX_SEM_BACKEND_MS &&
    millis() - ultimoSnapshotMs <= TEMPO_MAX_SEM_BACKEND_MS;
#else
  return false;  // Serial isolado nunca anuncia um carregador fisicamente disponivel.
#endif
}

void escreverLedEVs() {
  // Rede ou Backend indisponivel = sem verde "Disponivel" enganoso.
  const bool disponivel = backendDisponivel() && EMPS_HABILITAR_RELES;
  digitalWrite(PIN_EV1_VERDE, !ev1Carregando && disponivel ? HIGH : LOW);
  digitalWrite(PIN_EV2_VERDE, !ev2Carregando && disponivel ? HIGH : LOW);
  digitalWrite(PIN_EV1_VERMELHO, (ev1Carregando && faseVermelho) ? HIGH : LOW);
  digitalWrite(PIN_EV2_VERMELHO, (ev2Carregando && faseVermelho) ? HIGH : LOW);
}

void imprimirEstado(const char* origem) {
  Serial.printf("[%s] EV1=%d RELE_GPIO15=%d | EV2=%d RELE_GPIO33=%d | BAT=%u/4 | POSTE=%d PREDIO=%d\n",
    origem, ev1Carregando ? 1 : 0,
    ev1Carregando ? RELE_LIGADO : RELE_DESLIGADO,
    ev2Carregando ? 1 : 0,
    ev2Carregando ? RELE_LIGADO : RELE_DESLIGADO,
    niveisBateria, posteLigado ? 1 : 0, predioLigado ? 1 : 0);
}

// Thresholds solicitados pelo usuario, inclusive 65% (nao 75%).
uint8_t barrasParaSoC(float pct) {
  if (pct <= 0) return 0;
  if (pct <= 25) return 1;
  if (pct <= 50) return 2;
  if (pct <= 65) return 3;
  return 4;
}

float socMedio() {
  if (bat1Pct >= 0 && bat2Pct >= 0) return (bat1Pct + bat2Pct) / 2.0f;
  // Media indisponivel quando uma das duas baterias nao possui SoC.
  return -1;
}

void aplicarBarrasBateria(const char* origem) {
  const float soc = socMedio();
  niveisBateria = soc < 0 ? 0 : barrasParaSoC(soc);
  for (uint8_t i = 0; i < 4; i++) digitalWrite(PIN_BAT[i], i < niveisBateria ? HIGH : LOW);
  Serial.printf("[%s] SoC BAT1=%s%% BAT2=%s%% MEDIA=%s%% LEDS=%u/4\n", origem,
    bat1Pct >= 0 ? String(bat1Pct, 1).c_str() : "SEM",
    bat2Pct >= 0 ? String(bat2Pct, 1).c_str() : "SEM",
    soc >= 0 ? String(soc, 1).c_str() : "SEM", niveisBateria);
}

String linha16(String linha) {
  if (linha.length() > 16) linha = linha.substring(0, 16);
  while (linha.length() < 16) linha += ' ';
  return linha;
}

void avisoTemporario(const String& cima, const String& baixo, unsigned long duracaoMs = 6000) {
  avisoLinha1 = cima;
  avisoLinha2 = baixo;
  avisoExpiraMs = millis() + duracaoMs;
}

void construirTelaLCD(String& cima, String& baixo) {
  // RFID/status tem prioridade por alguns segundos e NAO autoriza rele.
  if (avisoExpiraMs && (int32_t)(millis() - avisoExpiraMs) < 0) {
    cima = avisoLinha1; baixo = avisoLinha2; return;
  }
  switch (paginaLCD % 7) {
    case 0:
#if EMPS_HABILITAR_RELES
      cima = ev1Carregando ? "EV1: CARREGANDO" : (backendDisponivel() ? "EV1: DISPONIVEL" : "EV1: DESLIGADO");
      baixo = ev2Carregando ? "EV2: CARREGANDO" : (backendDisponivel() ? "EV2: DISPONIVEL" : "EV2: DESLIGADO");
#else
      cima = ev1GieKw < 0 ? "EV1: SEM GIE" : "EV1 SIM " + String(ev1GieKw, 1) + " kW";
      baixo = ev2GieKw < 0 ? "EV2: SEM GIE" : "EV2 SIM " + String(ev2GieKw, 1) + " kW";
#endif
      break;
    case 1:
      cima = redeExportKw > 0 ? "REDE EXP " + String(redeExportKw,1) + "kW" : redeInformada ? "REDE IMP " + String(redeKw, 1) + "kW" : "REDE: SEM DADOS";
      baixo = solarInformado ? "SOLAR: " + String(solarKw, 1) + " kW" : "SOLAR: SEM DADOS";
      break;
    case 2: {
      const float medio = socMedio();
      cima = medio < 0 ? "BAT: SEM LEITURA" : "BAT MED: " + String(medio, 0) + "%";
      baixo = String(niveisBateria) + "/4 LEDS - SIM";
      break;
    }
    case 3:
      if (bat1Pct < 0 && bat2Pct < 0) {
        cima = bateriaConfirmadaAusente ? "SEM BATERIA" : "SOC AGUARDANDO";
        baixo = bateriaConfirmadaAusente ? "GIE SIMULADO" : "SEM DADO DO GIE";
      } else {
        cima = bat1Pct < 0 ? "BAT1: SEM DADOS" : "BAT1: " + String(bat1Pct, 1) + "%";
        baixo = bat2Pct < 0 ? "BAT2: SEM DADOS" : "BAT2: " + String(bat2Pct, 1) + "%";
      }
      break;
    case 4:
      cima = predioKw < 0 ? "PREDIO SEM DADO" : "PREDIO " + String(predioKw,1) + " kW";
      baixo = String("PREDIO: ") + (predioLigado ? "LIGADO" : "DESLIGADO");
      break;
    case 5:
      cima = estacaoExibida;
      baixo = "GIE SIMULADO";
      break;
    default:
      cima = "GIE SIMULADO";
      baixo = cenarioGieExibido.length() ? cenarioGieExibido : "CENARIO SEM DATA";
      break;
  }
}

void atualizarLCD() {
  String cima, baixo;
  construirTelaLCD(cima, baixo);
  cima = linha16(cima); baixo = linha16(baixo);
  if (cima == ultimaLinhaLCD1 && baixo == ultimaLinhaLCD2) return;
  ultimaLinhaLCD1 = cima;
  ultimaLinhaLCD2 = baixo;
  // Permite ver a tela emulado no Serial SEM LCD conectado.
  Serial.printf("[LCD PREVIA] |%s| / |%s|\n", cima.c_str(), baixo.c_str());
#if EMPS_USAR_LCD
  if (!lcd) return;
  lcd->setCursor(0, 0); lcd->print(cima);
  lcd->setCursor(0, 1); lcd->print(baixo);
#endif
}

void alterarEV(uint8_t ev, bool carregar, const char* origem) {
  bool* atual = (ev == 1) ? &ev1Carregando : &ev2Carregando;
  if (ev != 1 && ev != 2) return;
  if (*atual == carregar) {
    Serial.printf("[%s] EV%u ja esta em %d (idempotente).\n", origem, ev, carregar ? 1 : 0);
    return;
  }
  *atual = carregar;
  const uint8_t rele = ev == 1 ? PIN_RELE_EV1 : PIN_RELE_EV2;
  digitalWrite(rele, carregar ? RELE_LIGADO : RELE_DESLIGADO);
  if (carregar) faseVermelho = true; // primeiro instante vermelho ligado
  escreverLedEVs();
  imprimirEstado(origem);
  atualizarLCD();
}

void alterarBateria(float pct, const char* origem) {
  bat1Pct = constrain(pct, 0.0f, 100.0f);
  bat2Pct = -1; bateriaConfirmadaAusente = false;
  aplicarBarrasBateria(origem);
  atualizarLCD();
}

bool interpretarNumero(String valor, float minimo, float maximo, float& resultado) {
  valor.trim();
  if (!valor.length()) return false;
  char* fim = nullptr;
  const float numero = strtof(valor.c_str(), &fim);
  if (fim == valor.c_str() || *fim != '\0' || !isfinite(numero) || numero < minimo || numero > maximo) return false;
  resultado = numero;
  return true;
}

void alterarLuz(bool poste, bool ligada, const char* origem) {
  if (!poste) ligada = true; // Iluminacao fixa; independente do consumo e da conectividade.
  if (poste && posteLigado == ligada) return;
  if (!poste && predioLigado == ligada) return;
  if (poste) { posteLigado = ligada; digitalWrite(PIN_POSTE, ligada ? HIGH : LOW); }
  else { predioLigado = ligada; digitalWrite(PIN_PREDIO, ligada ? HIGH : LOW); }
  imprimirEstado(origem);
  atualizarLCD();
}

// Mesmo interpretador usado pelo Serial e pelos comandos aceitos do Backend.
// Retorna false se o comando e invalido; nesse caso NADA e acionado.
bool executarComando(String cmd, const char* origem) {
  cmd.trim(); cmd.toUpperCase();
#if EMPS_USAR_WIFI
  // Em modo integrado, comandos de LIGAR so podem vir do Backend autenticado.
  // O Serial ainda pode PARAR para permitir um desligamento emergencial local.
  if (String(origem) == "SERIAL" && cmd != "0" && cmd != "EV1=0" &&
      cmd != "EV2=0" && cmd != "STATUS" && cmd != "AJUDA") {
    Serial.println("[SEGURANCA] Wi-Fi ativo: acionamento so via Backend; Serial permite apenas desligar.");
    return false;
  }
#endif
#if !EMPS_HABILITAR_RELES
  if (cmd == "1" || cmd == "EV1=1" || cmd == "EV2=1") {
    Serial.println("[SEGURANCA] Reles bloqueados nesta compilacao; comando de ligar recusado.");
    return false;
  }
#endif
  if (cmd == "1" || cmd == "EV1=1") { alterarEV(1, true, origem); return true; }
  if (cmd == "0" || cmd == "EV1=0") { alterarEV(1, false, origem); return true; }
  if (cmd == "EV2=1") { alterarEV(2, true, origem); return true; }
  if (cmd == "EV2=0") { alterarEV(2, false, origem); return true; }
  if (cmd == "POSTE=1") { alterarLuz(true, true, origem); return true; }
  if (cmd == "POSTE=0") { alterarLuz(true, false, origem); return true; }
  if (cmd == "PREDIO=1") { alterarLuz(false, true, origem); return true; }
  if (cmd == "PREDIO=0") { alterarLuz(false, false, origem); return true; }
  if (cmd == "BAT=OFF" || cmd == "BAT=SEM") {
    bat1Pct = -1; bat2Pct = -1; bateriaConfirmadaAusente = true;
    aplicarBarrasBateria(origem); atualizarLCD(); return true;
  }
  if (cmd.startsWith("BAT=") || cmd.startsWith("BAT1=") || cmd.startsWith("BAT2=")) {
    const bool eh1 = cmd.startsWith("BAT1=");
    const bool eh2 = cmd.startsWith("BAT2=");
    const String raw = cmd.substring(eh1 || eh2 ? 5 : 4);
    float percentual;
    if (!interpretarNumero(raw, 0, 100, percentual)) return false;
    bateriaConfirmadaAusente = false;
    if (eh1) { bat1Pct = percentual; }
    else if (eh2) { bat2Pct = percentual; }
    else { alterarBateria(percentual, origem); return true; }
    aplicarBarrasBateria(origem); atualizarLCD(); return true;
  }
  if (cmd.startsWith("REDE=") || cmd.startsWith("SOLAR=")) {
    const bool ehRede = cmd.startsWith("REDE=");
    float potencia;
    if (!interpretarNumero(cmd.substring(ehRede ? 5 : 6), 0, 9999, potencia)) return false;
    if (ehRede) { redeKw = potencia; redeInformada = true; }
    else { solarKw = potencia; solarInformado = true; }
    Serial.printf("[%s] %s=%.2f kW (VALOR GIE SIMULADO)\n", origem, ehRede ? "REDE" : "SOLAR", potencia);
    atualizarLCD(); return true;
  }
  if (cmd.startsWith("ESTACAO=")) {
    String nome = cmd.substring(8); nome.trim();
    if (!nome.length() || nome.length() > 32) return false;
    estacaoExibida = nome;
    Serial.printf("[%s] Nome de estacao no LCD: %s (NAO altera vinculo Backend)\n", origem, nome.c_str());
    atualizarLCD(); return true;
  }
  if (cmd.startsWith("RFID_OK=")) {
    String pessoa = cmd.substring(8); pessoa.trim();
    if (!pessoa.length() || pessoa.length() > 32) return false;
    avisoTemporario("RFID APROVADO", pessoa);
    Serial.printf("[%s] RFID aprovado: %s (APENAS AVISO; nao liga rele)\n", origem, pessoa.c_str());
    atualizarLCD(); return true;
  }
  if (cmd == "RFID_NEGADO") {
    avisoTemporario("RFID NEGADO", "ACESSO RECUSADO");
    Serial.printf("[%s] RFID negado; rele inalterado\n", origem);
    atualizarLCD(); return true;
  }
  if (cmd == "RFID_TESTE") {
    avisoTemporario("RFID DETECTADO", "AGUARDE BACKEND");
    Serial.printf("[%s] RFID ficticio detectado; aguardando autorizacao\n", origem);
    atualizarLCD(); return true;
  }
  if (cmd == "STATUS") { imprimirEstado(origem); Serial.printf("[GIE SIMULADO] REDE=%s SOLAR=%s BAT1=%s BAT2=%s\n", redeInformada ? String(redeKw,1).c_str() : "--", solarInformado ? String(solarKw,1).c_str() : "--", bat1Pct >= 0 ? String(bat1Pct,1).c_str() : "--", bat2Pct >= 0 ? String(bat2Pct,1).c_str() : "--"); atualizarLCD(); return true; }
  if (cmd == "AJUDA") {
    Serial.println("Comandos: 1,0, EV2=1/0, BAT=65, BAT1=60.8, BAT2=71.8, BAT=OFF, REDE=12.2, SOLAR=27.1, ESTACAO=POSTO 24H, RFID_TESTE, RFID_OK=USUARIO 01, RFID_NEGADO, POSTE=1/0, PREDIO=1/0, STATUS");
    return true;
  }
  return false;
}

#if EMPS_USAR_WIFI
bool fazerRequisicao(const String& caminho, bool post, const String& body, String& resposta, int& status) {
  const String base = String(EMPS_SERVER_BASE);
  const String url = base + caminho;
  const bool https = base.startsWith("https://");
  HTTPClient http;
  WiFiClient httpClient;
  WiFiClientSecure secureClient;
  if (https) {
    if (strlen(EMPS_CA_CERT_PEM) < 100) { Serial.println("[WIFI] Certificado CA obrigatorio para HTTPS."); return false; }
    secureClient.setCACert(EMPS_CA_CERT_PEM);
    if (!http.begin(secureClient, url)) return false;
  } else if (base.startsWith("http://")) {
    if (!http.begin(httpClient, url)) return false;
  } else return false;
  http.setTimeout(2500);
  http.addHeader("X-Device-Token", EMPS_DEVICE_TOKEN);
  http.addHeader("Accept", "text/plain");
  if (post) http.addHeader("Content-Type", "application/json");
  status = post ? http.POST(body) : http.GET();
  resposta = status > 0 ? http.getString() : "";
  http.end();
  return status >= 200 && status < 300;
}

String valorCampo(const String& resposta, const char* chave) {
  const String prefixo = String(chave) + "=";
  int inicio = resposta.indexOf(prefixo);
  if (inicio < 0 || (inicio > 0 && resposta[inicio - 1] != '\n')) return "";
  inicio += prefixo.length();
  int fim = resposta.indexOf('\n', inicio);
  String valor = resposta.substring(inicio, fim < 0 ? resposta.length() : fim);
  valor.trim();
  return valor;
}

void limparGie(const char* origem) {
  redeInformada = false;
  solarInformado = false;
  bat1Pct = -1;
  bat2Pct = -1;
  bateriaConfirmadaAusente = false;
  cenarioGieExibido = "";
  aplicarBarrasBateria(origem);
  alterarLuz(true, false, origem);
  alterarLuz(false, false, origem);
  atualizarLCD();
}

void desligarPorFalha(const char* origem) {
  ultimaConsultaBemSucedidaMs = 0;
  ultimoSnapshotMs = 0;
  if (ev1Carregando) alterarEV(1, false, origem);
  if (ev2Carregando) alterarEV(2, false, origem);
  digitalWrite(PIN_RELE_EV1, RELE_DESLIGADO);
  digitalWrite(PIN_RELE_EV2, RELE_DESLIGADO);
  if (digitalRead(PIN_RELE_EV1) != RELE_DESLIGADO || digitalRead(PIN_RELE_EV2) != RELE_DESLIGADO)
    Serial.println("[SEGURANCA] GPIO de rele nao confirmou HIGH; inspecao fisica necessaria.");
  escreverLedEVs();
  limparGie(origem);
}

void aplicarSnapshot(const String& resposta) {
  // A autorizacao de laboratorio e independente dos setpoints do GIE.
  // Campo ausente tambem revoga a autorizacao, inclusive se STOP se perder.
  if (ev1Carregando && valorCampo(resposta, "ev1Authorized") != "1") {
    alterarEV(1, false, "AUTORIZACAO_EV1_REVOGADA");
  }
  if (ev2Carregando && valorCampo(resposta, "ev2Authorized") != "1") {
    alterarEV(2, false, "AUTORIZACAO_EV2_REVOGADA");
  }
  // O Backend e a unica fonte dos valores GIE. Snapshot invalido nao conserva
  // SoC antigo nem interpreta ausencia como 0%.
  String nome = valorCampo(resposta, "stationName");
  if (nome.length() && nome.length() <= 32) estacaoExibida = nome;
  if (valorCampo(resposta, "gieValid") != "1" || valorCampo(resposta, "gieSource") != "SIMULATED") {
    limparGie("GIE_INDISPONIVEL");
    return;
  }
  String instante = valorCampo(resposta, "gieScenarioAt");
  cenarioGieExibido = "";
  if (valorCampo(resposta, "gieSource") == "SIMULATED" && instante.length() >= 16 &&
      instante[4] == '-' && instante[7] == '-' && instante[10] == 'T' && instante[13] == ':') {
    cenarioGieExibido = instante.substring(0, 16);
    cenarioGieExibido.setCharAt(10, ' ');
  }
  float valor = 0;
  redeInformada = interpretarNumero(valorCampo(resposta, "gridKw"), -9999, 9999, valor);
  if (redeInformada) redeKw = valor;
  solarInformado = interpretarNumero(valorCampo(resposta, "solarKw"), 0, 9999, valor);
  if (solarInformado) solarKw = valor;
  bat1Pct = interpretarNumero(valorCampo(resposta, "bat01Soc"), 0, 100, valor) ? valor : -1;
  bat2Pct = interpretarNumero(valorCampo(resposta, "bat02Soc"), 0, 100, valor) ? valor : -1;
  bateriaConfirmadaAusente = valorCampo(resposta, "batteryInstalled") == "0";
  if (bateriaConfirmadaAusente) { bat1Pct = -1; bat2Pct = -1; }
  aplicarBarrasBateria("GIE_SIMULADO");
  alterarLuz(true, valorCampo(resposta, "poleLight") == "1", "GIE_SIMULADO");
  alterarLuz(false, valorCampo(resposta, "buildingLight") == "1", "GIE_SIMULADO");
  atualizarLCD();
}

void enviarHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - ultimoHeartbeatMs < INTERVALO_HEARTBEAT_MS) return;
  ultimoHeartbeatMs = millis();
  String json = String("{\"bootId\":\"") + bootId + "\",\"firmwareVersion\":\"" + VERSAO_FIRMWARE + "\"";
  if (ultimoIdComando.length()) json += String(",\"lastCommandId\":\"") + ultimoIdComando + "\"";
  json += String(",\"ev1\":") + (ev1Carregando ? "true" : "false") +
    ",\"ev2\":" + (ev2Carregando ? "true" : "false") +
    ",\"batteryBars\":" + String(niveisBateria) +
    ",\"poleLight\":" + (posteLigado ? "true" : "false") +
    ",\"buildingLight\":" + (predioLigado ? "true" : "false") + "}";
  String corpo; int status = 0;
  if (fazerRequisicao(String("/devices/") + EMPS_DEVICE_ID + "/heartbeat", true, json, corpo, status)) {
    const String auth1 = valorCampo(corpo, "ev1Authorized");
    const String auth2 = valorCampo(corpo, "ev2Authorized");
    const String gieValido = valorCampo(corpo, "gieValid");
    if (valorCampo(corpo, "stationId") != ESTACAO_LOCAL_ID ||
        (auth1 != "0" && auth1 != "1") || (auth2 != "0" && auth2 != "1") ||
        (gieValido != "0" && gieValido != "1")) {
      Serial.println("[BACKEND] Heartbeat com vinculo ou autorizacao invalida; desligamento seguro.");
      desligarPorFalha("SNAPSHOT_INVALIDO");
      return;
    }
    ultimoSnapshotMs = millis();
    aplicarSnapshot(corpo);
  } else if (status == 401 || status == 403) {
    Serial.printf("[BACKEND] Autorizacao revogada (HTTP %d). Desligamento seguro.\n", status);
    desligarPorFalha("SEM_AUTORIZACAO");
  } else {
    Serial.printf("[BACKEND] Heartbeat sem resposta valida (HTTP %d); reles continuam seguros.\n", status);
  }
}

bool comandoRemotoPermitido(const String& acao) {
  return acao == "EV1=1" || acao == "EV1=0" || acao == "EV2=1" || acao == "EV2=0";
}

bool estadoConfirmaAcao(const String& acao) {
  // Confirma somente nivel logico no GPIO, nunca contato fisico do rele.
  if (acao == "EV1=1") return ev1Carregando && digitalRead(PIN_RELE_EV1) == RELE_LIGADO;
  if (acao == "EV1=0") return !ev1Carregando && digitalRead(PIN_RELE_EV1) == RELE_DESLIGADO;
  if (acao == "EV2=1") return ev2Carregando && digitalRead(PIN_RELE_EV2) == RELE_LIGADO;
  if (acao == "EV2=0") return !ev2Carregando && digitalRead(PIN_RELE_EV2) == RELE_DESLIGADO;
  return false;
}

bool idValido(const String& id) {
  if (id.length() != 36) return false;
  for (unsigned i = 0; i < id.length(); ++i) {
    const char c = id[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!isxdigit(static_cast<unsigned char>(c))) return false;
  }
  return true;
}

bool ackConfirmado(const String& resposta, const String& id) {
  // 2xx sozinho nao confirma uma acao: o Backend tambem pode responder
  // FAILED ou EXPIRED com HTTP 200. JSON inesperado falha fechado.
  const String idJson = String("\"commandId\":\"") + id + "\"";
  return resposta.indexOf(idJson) >= 0 && resposta.indexOf("\"status\":\"ACKED\"") >= 0;
}

void consultarComando() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - ultimaConsultaMs < INTERVALO_CONSULTA_MS) return;
  ultimaConsultaMs = millis();
  String resposta; int status = 0;
  if (!fazerRequisicao(String("/devices/") + EMPS_DEVICE_ID + "/commands/next", false, "", resposta, status)) {
    Serial.printf("[BACKEND] Sem resposta valida (HTTP %d)\n", status);
    if (status == 401 || status == 403) desligarPorFalha("SEM_AUTORIZACAO");
    return;
  }
  if (status == 204) {
    ultimaConsultaBemSucedidaMs = millis();
    escreverLedEVs();
    return; // nenhum comando pendente
  }

  // HTTP 200: ID_UNICO|EV1=1|ttlMs. O Backend so entrega comandos
  // autorizados e nao expirados; TTL invalido nunca aciona saidas.
  resposta.trim();
  const int primeiro = resposta.indexOf('|');
  const int segundo = resposta.indexOf('|', primeiro + 1);
  if (primeiro <= 0 || segundo <= primeiro || resposta.indexOf('|', segundo + 1) >= 0) {
    Serial.println("[BACKEND] Formato de comando invalido; desligamento seguro.");
    desligarPorFalha("COMANDO_INVALIDO"); return;
  }
  String id = resposta.substring(0, primeiro), acao = resposta.substring(primeiro + 1, segundo);
  String ttlRaw = resposta.substring(segundo + 1);
  id.trim(); acao.trim(); ttlRaw.trim();
  char* fim = nullptr;
  const unsigned long ttlMs = strtoul(ttlRaw.c_str(), &fim, 10);
  if (!idValido(id) || !comandoRemotoPermitido(acao) || ttlRaw.length() == 0 || *fim != '\0' || ttlMs == 0 || ttlMs > 15000) {
    Serial.println("[BACKEND] ID, acao ou validade invalida; desligamento seguro.");
    desligarPorFalha("COMANDO_INVALIDO"); return;
  }
  ultimaConsultaBemSucedidaMs = millis();
  escreverLedEVs();
  Serial.printf("[BACKEND] RECEBIDO id=%s comando=%s validade=%lu ms.\n",
    id.c_str(), acao.c_str(), ttlMs);
  int indiceAnterior = -1;
  for (uint8_t i = 0; i < 8; ++i) if (idsAplicados[i] == id) { indiceAnterior = i; break; }
  bool aceito = false;
  if (indiceAnterior >= 0) {
    aceito = acoesAplicadas[indiceAnterior] == acao && estadoConfirmaAcao(acao);
    Serial.printf("[BACKEND] ID repetido %s; sem novo acionamento.\n", id.c_str());
  } else {
    // Nunca inicia sem um heartbeat autenticado recente. STOP continua aceito.
    const bool iniciar = acao.endsWith("=1");
    aceito = (!iniciar || (ultimoSnapshotMs && millis() - ultimoSnapshotMs <= TEMPO_MAX_SEM_BACKEND_MS)) &&
      executarComando(acao, "SITE") && estadoConfirmaAcao(acao);
    if (aceito) {
      idsAplicados[proximoIdAplicado] = id;
      acoesAplicadas[proximoIdAplicado] = acao;
      proximoIdAplicado = (proximoIdAplicado + 1) % 8;
    } else if (iniciar) {
      desligarPorFalha("GPIO_OU_HEARTBEAT_INVALIDO");
    }
  }
  if (!aceito) {
    Serial.printf("[BACKEND] RECUSADO LOCALMENTE id=%s comando=%s; saida segura.\n",
      id.c_str(), acao.c_str());
  }
  const String json = String("{\"commandId\":\"") + id + "\",\"accepted\":" + (aceito ? "true" : "false") +
    ",\"ev1\":" + (ev1Carregando ? "true" : "false") + ",\"ev2\":" + (ev2Carregando ? "true" : "false") + "}";
  String corpo;
  int ack = 0;
  if (!fazerRequisicao(String("/devices/") + EMPS_DEVICE_ID + "/commands/ack", true, json, corpo, ack) ||
      !ackConfirmado(corpo, id)) {
    Serial.printf("[BACKEND] NAO CONFIRMADO id=%s comando=%s (HTTP %d); desligamento seguro.\n",
      id.c_str(), acao.c_str(), ack);
    desligarPorFalha("FALHA_ACK");
  } else {
    ultimoIdComando = id;
    Serial.printf("[BACKEND] CONFIRMADO id=%s comando=%s (somente nivel logico do GPIO; sem medicao do contato).\n",
      id.c_str(), acao.c_str());
  }
}

#include "energy_ws.h"

void trabalharWifi() {
  if (WiFi.status() != WL_CONNECTED) {
    enderecoWifiInformado = false;
    if(energyReceivedMs || energyChannel.length()) { energyOff("FALHA_WIFI");energyChannel="";energySocket.disconnect(); }
    if (millis() - ultimaTentativaWifiMs > 10000) {
      ultimaTentativaWifiMs = millis(); WiFi.disconnect(); WiFi.begin(EMPS_WIFI_SSID, EMPS_WIFI_SENHA);
      Serial.println("[WIFI] Tentando conectar...");
    }
    return;
  }
  if (!enderecoWifiInformado) {
    enderecoWifiInformado = true;
    const String ip = WiFi.localIP().toString();
    Serial.printf("[WIFI] ESP32 conectado: IP=%s; ponte=%s\n", ip.c_str(), EMPS_SERVER_BASE);
  }
  energyLoop();
  if ((ultimaConsultaBemSucedidaMs && millis() - ultimaConsultaBemSucedidaMs > TEMPO_MAX_SEM_BACKEND_MS) ||
      (ultimoSnapshotMs && millis() - ultimoSnapshotMs > TEMPO_MAX_SEM_BACKEND_MS)) {
    desligarPorFalha("FALHA_BACKEND");
  }
}
#endif

void lerRFID() {
#if EMPS_USAR_RFID
  if (!leitor.PICC_IsNewCardPresent() || !leitor.PICC_ReadCardSerial()) return;
  String uid;
  Serial.print("[RFID] UID lido (NAO libera rele sozinho): ");
  for (byte i = 0; i < leitor.uid.size; ++i) {
    if (leitor.uid.uidByte[i] < 0x10) Serial.print('0');
    Serial.print(leitor.uid.uidByte[i], HEX);
    if (leitor.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(leitor.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  Serial.println();
  avisoTemporario("RFID DETECTADO", "AGUARDE BACKEND");
  atualizarLCD();
  leitor.PICC_HaltA();
  leitor.PCD_StopCrypto1();
#if EMPS_USAR_WIFI
  if (!backendDisponivel()) {
    avisoTemporario("RFID NEGADO", "SEM CONEXAO");
    atualizarLCD();
    return;
  }
  const String json = String("{\"uid\":\"") + uid + "\"}";
  String resposta; int status = 0;
  if (!fazerRequisicao(String("/devices/") + EMPS_DEVICE_ID + "/rfid", true, json, resposta, status)) {
    avisoTemporario("RFID NEGADO", "SEM AUTORIZACAO");
    Serial.printf("[RFID] Backend recusou consulta (HTTP %d); rele inalterado.\n", status);
  } else if (resposta.startsWith("APPROVED|")) {
    String nome = resposta.substring(9);
    nome.trim();
    if (nome.length() == 0 || nome.length() > 16) nome = "USUARIO TESTE";
    avisoTemporario("RFID APROVADO", nome);
    Serial.printf("[RFID] Aprovado para exibicao: %s; rele inalterado.\n", nome.c_str());
  } else {
    avisoTemporario("RFID NEGADO", "ACESSO RECUSADO");
    Serial.println("[RFID] Acesso negado; rele inalterado.");
  }
  atualizarLCD();
#else
  Serial.println("[RFID] Wi-Fi desligado; apenas previa local, rele inalterado.");
#endif
#endif
}

void setup() {
  // Estado seguro antes de habilitar modo OUTPUT. GPIO15 e pino de boot:
  // O circuito EXTERNO deve impedir acionamento durante reset/boot.
  digitalWrite(PIN_RELE_EV1, RELE_DESLIGADO);
  digitalWrite(PIN_RELE_EV2, RELE_DESLIGADO);
  pinMode(PIN_RELE_EV1, OUTPUT);
  pinMode(PIN_RELE_EV2, OUTPUT);
  digitalWrite(PIN_RELE_EV1, RELE_DESLIGADO);
  digitalWrite(PIN_RELE_EV2, RELE_DESLIGADO);
  Serial.begin(115200);
  delay(700);
  Serial.printf("[EMPS] Firmware=%s\n", VERSAO_FIRMWARE);
  const uint8_t leds[] = {PIN_EV1_VERMELHO, PIN_EV1_VERDE, PIN_EV2_VERMELHO, PIN_EV2_VERDE,
    PIN_BAT[0], PIN_BAT[1], PIN_BAT[2], PIN_BAT[3], PIN_POSTE, PIN_PREDIO};
  for (uint8_t pin : leds) { pinMode(pin, OUTPUT); digitalWrite(pin, LOW); }
  digitalWrite(PIN_PREDIO, HIGH);
  escreverLedEVs();

#if EMPS_USAR_LCD
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  uint8_t endereco = 0;
  for (uint8_t a : {uint8_t(0x27), uint8_t(0x3F)}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { endereco = a; break; }
  }
  if (endereco) {
    lcd = new LiquidCrystal_I2C(endereco, 16, 2);
    lcd->init(); lcd->backlight(); atualizarLCD();
  } else Serial.println("[LCD] Nenhum PCF8574 em 0x27/0x3F; seguindo sem LCD.");
#endif
#if EMPS_USAR_RFID
  SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
  leitor.PCD_Init();
  Serial.println("[RFID] RC522 inicializado. Ler cartao apenas informa UID.");
#endif
#if EMPS_USAR_WIFI
  bootId = "esp_" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX) + "_" + String((uint32_t)esp_random(), HEX);
  WiFi.mode(WIFI_STA);
  WiFi.begin(EMPS_WIFI_SSID, EMPS_WIFI_SENHA);
  ultimaTentativaWifiMs = millis();
  ultimoHeartbeatMs = millis() - INTERVALO_HEARTBEAT_MS;
  Serial.println("[WIFI] Cliente de comandos habilitado.");
#else
  Serial.println("[TESTE] Wi-Fi desligado. Digite comandos no Monitor Serial.");
#endif
#if EMPS_HABILITAR_RELES
  Serial.println("[SAIDAS] Reles HABILITADOS para maquete USB verificada.");
#else
  Serial.println("[SAIDAS] Reles BLOQUEADOS; teste de comunicacao sem carga.");
#endif
  Serial.println("[EMPS] Maquete pronta. EV1=0 e EV2=0; RELES DESLIGADOS.");
  executarComando("AJUDA", "BOOT");
  imprimirEstado("BOOT");
  atualizarLCD();
}

void loop() {
  while (Serial.available()) {
    char c = char(Serial.read());
    if (c == '\n' || c == '\r') {
      if (entradaSerial.length()) {
        if (!executarComando(entradaSerial, "SERIAL")) Serial.println("[SERIAL] Comando nao executado (invalido ou bloqueado). Digite AJUDA.");
        entradaSerial = "";
      }
    } else if (entradaSerial.length() < 64 && c >= 32 && c <= 126) entradaSerial += c;
  }
  if (millis() - ultimaTrocaPaginaMs >= INTERVALO_LCD_MS) {
    ultimaTrocaPaginaMs = millis(); paginaLCD = (paginaLCD + 1) % 7; atualizarLCD();
  }
  if (millis() - ultimoPiscaMs >= INTERVALO_PISCA_MS) {
    ultimoPiscaMs = millis(); faseVermelho = !faseVermelho; escreverLedEVs();
  }
  lerRFID();
  // Restaura a tela normal apos a mensagem RFID temporaria expirar.
  if (avisoExpiraMs && (int32_t)(millis() - avisoExpiraMs) >= 0) {
    avisoExpiraMs = 0; atualizarLCD();
  }
#if EMPS_USAR_WIFI
  trabalharWifi();
#endif
  delay(5);
}
