#pragma once
#include <stdint.h>
#include <math.h>
inline bool sessaoIndicada(bool transporte, bool sessao, bool autorizacao) {
  return transporte && sessao && autorizacao;
}
// Yellow pole: mostly steady, two short OFF flashes every five seconds.
constexpr bool ledPosteAceso(bool importa, uint32_t agora) {
  return importa && !((agora%5000>=4000 && agora%5000<4100) ||
                     (agora%5000>=4200 && agora%5000<4300));
}
// Solar: slow independent cadence, 2.1 s ON / 1.1 s OFF, shifted from the pole.
constexpr bool ledSolarAceso(bool gerando, uint32_t agora) {
  return gerando && ((agora%3200+1100)%3200<2100);
}
static_assert(!ledPosteAceso(false,0) && !ledSolarAceso(false,0), "Missing source must stay off");
static_assert(ledPosteAceso(true,3999) && !ledPosteAceso(true,4000) && !ledPosteAceso(true,4099), "First short flash");
static_assert(ledPosteAceso(true,4100) && ledPosteAceso(true,4199), "Gap between flashes");
static_assert(!ledPosteAceso(true,4200) && !ledPosteAceso(true,4299) && ledPosteAceso(true,4300), "Second short flash");
static_assert(ledPosteAceso(true,4999) && ledPosteAceso(true,5000), "Pole returns to steady light");
static_assert(ledSolarAceso(true,999) && !ledSolarAceso(true,1000) && !ledSolarAceso(true,2099), "Slow solar OFF window");
static_assert(ledSolarAceso(true,2100) && ledSolarAceso(true,3199) && ledSolarAceso(true,3200), "Slow solar ON window");
static_assert(ledPosteAceso(true,5000)==ledPosteAceso(true,0) && ledSolarAceso(true,3200)==ledSolarAceso(true,0), "Independent periodic patterns");
inline uint8_t mascaraBateria(bool valido, float soc, float carga, uint32_t millisAgora) {
  if (!valido || !isfinite(soc) || soc < 0 || soc > 100) return 0;
  // Full 25% blocks stay on; next block pulses, including idle battery.
  if (soc<=0) return 0;
  uint8_t barras = soc>=100 ? 4 : (uint8_t)(soc/25);
  uint8_t mask=(1u<<barras)-1;
  if(barras<4 && millisAgora%1000<800) mask |= 1u<<barras;
  return mask;
}
