import type { Draft, Station } from './station-types';
import { draftFrom } from './station-types';
import { wizardPayload } from './station-wizard-model';

type WizardApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function persistWizardDraft({ stationId, station, draft, photos, submit, request, onPhotoSaved }: {
  stationId: string; station: Station | null; draft: Draft;
  photos: Record<number, File>; submit: boolean; request: WizardApi;
  onPhotoSaved: (position: number) => void;
}): Promise<Station> {
  // Photos must finish before a technical PATCH can lock an active station for review.
  for (const [position, file] of Object.entries(photos)) {
    const body = new FormData();
    body.append('position', position); body.append('file', file);
    await request(`/v2/stations/${stationId}/photos`, { method: 'POST', body });
    onPhotoSaved(Number(position));
  }
  const payload = wizardPayload(draft, station ? draftFrom(station) : null, station?.status === 'ACTIVE');
  const row = await request<Station>(`/v2/stations/${stationId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  if (submit) await request(`/v2/stations/${stationId}/submit`, { method: 'POST' });
  return submit ? request<Station>(`/v2/stations/${stationId}`) : row;
}
