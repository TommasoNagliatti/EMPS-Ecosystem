import type { GieV3State } from './gie-v3-contract';

/** Native commercial /cycle does not auto-advance its default timestamp.
 * Continue the worker's own synthetic history; never use the computer's clock,
 * replace measurements or replay its previous interval. First cycle keeps the native default.
 */
export function commercialFixtureCycleBody(state: GieV3State): { issue_time?: string } {
  if (state.station_id !== 'Commercial_HighAutonomy_V2') throw new Error('Perfil comercial divergente');
  const previous = state.history.at(-1);
  if (!previous) return {};
  const issued = Date.parse(previous.issue_time);
  if (previous.station_id !== state.station_id || previous.origin !== 'SIMULATED' ||
      !/[+-]\d\d:\d\d$|Z$/.test(previous.issue_time) || !Number.isFinite(issued) || issued % (15*60_000) !== 0)
    throw new Error('Histórico de ciclos comercial inválido');
  return { issue_time: new Date(issued + 15*60_000).toISOString() };
}
