#pragma once
#include <stdint.h>
#include <math.h>
inline bool sessaoIndicada(bool transporte, bool sessao, bool autorizacao) {
  return transporte && sessao && autorizacao;
}
inline uint8_t mascaraBateria(bool valido, float soc, float carga, uint32_t millisAgora) {
  if (!valido || !isfinite(soc) || soc < 0 || soc > 100) return 0;
  // Full 25% blocks stay on; next block pulses, including idle battery.
  if (soc<=0) return 0;
  uint8_t barras = soc>=100 ? 4 : (uint8_t)(soc/25);
  uint8_t mask=(1u<<barras)-1;
  if(barras<4 && millisAgora%1000<800) mask |= 1u<<barras;
  return mask;
}
