import { Prisma } from '@prisma/client';

export function bill(energy: Prisma.Decimal.Value, rate: Prisma.Decimal.Value, fee: Prisma.Decimal.Value, limit?: Prisma.Decimal.Value | null) {
  const energyKwh = new Prisma.Decimal(energy).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  const energyAmount = energyKwh.mul(rate);
  let total = energyAmount.add(fee);
  if (limit !== null && limit !== undefined) total = Prisma.Decimal.min(total, new Prisma.Decimal(limit));
  return { energyKwh: energyKwh.toNumber(), pricePerKwh: new Prisma.Decimal(rate).toNumber(),
    fixedFee: new Prisma.Decimal(fee).toNumber(), energyAmount: energyAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    total: total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber() };
}
