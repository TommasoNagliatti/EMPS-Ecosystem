'use client';

import { ImagePlus, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { amenities, type Draft, type Station } from './station-types';
import { hasPosition, type DraftChange, type WizardStep } from './station-wizard-model';
import { StationPhoto } from './StationPhoto';
import { WizardDisclosure } from './StationWizardField';
import styles from './station-wizard.module.css';

export type WizardPhotos = Record<number, File>;

function PhotoSlot({ position, photo, file, onChange }: {
  position: number; photo?: Station['photos'][number]; file?: File;
  onChange: (position: number, file?: File) => void;
}) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const label = position === 0 ? 'Foto principal' : `Foto adicional ${position}`;
  return <div className={styles.photoSlot}>
    <div className={styles.photoPreview}>
      {preview ? <img src={preview} alt={label} /> : <StationPhoto id={photo?.id} version={photo?.storageKey} alt={label} />}
      {file && <button type="button" className={styles.photoCancel} aria-label={`Cancelar seleção da ${label.toLowerCase()}`} title="Cancelar seleção" onClick={() => onChange(position)}><X size={15} aria-hidden="true" /></button>}
    </div>
    <label className={styles.uploadButton}><ImagePlus size={16} aria-hidden="true" /><span>{label}</span><input className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Selecionar ${label.toLowerCase()}`} onChange={event => { const selected = event.target.files?.[0]; if (selected) onChange(position, selected); event.target.value = ''; }} /></label>
    {file && <span className={styles.fileName} title={file.name}>{file.name}</span>}
  </div>;
}

export function StationFinishFields({ draft, station, photos, onPhotoChange, onChange, onEdit }: {
  draft: Draft; station: Station | null; photos: WizardPhotos;
  onPhotoChange: (position: number, file?: File) => void; onChange: DraftChange;
  onEdit: (step: WizardStep) => void;
}) {
  const address = [draft.street, draft.addressNumber, draft.city, draft.state].filter(Boolean).join(', ');
  const solarCount = draft.solarAssets.filter(asset => asset.status !== 'INACTIVE').length;
  const batteryCount = draft.batteries.filter(asset => asset.status !== 'INACTIVE').length;
  const chargerCount = draft.chargers.filter(charger => charger.administrativeStatus !== 'DISABLED').length;
  return <>
    <section className={styles.section}>
      <h2>Fotos</h2>
      <div className={styles.mainPhoto}>
        <PhotoSlot position={0} photo={station?.photos.find(photo => photo.position === 0)} file={photos[0]} onChange={onPhotoChange} />
        <p className={styles.photoNote}>JPEG, PNG ou WebP<br />Até 8 MB por foto</p>
      </div>
      <WizardDisclosure title="Fotos adicionais">
        <div className={styles.additionalPhotos}>{[1, 2, 3, 4].map(position => <PhotoSlot key={position} position={position} photo={station?.photos.find(photo => photo.position === position)} file={photos[position]} onChange={onPhotoChange} />)}</div>
      </WizardDisclosure>
    </section>
    <section className={styles.section}>
      <h2>Comodidades</h2>
      <div className={styles.amenities}>{amenities.map(amenity => <label className={styles.check} key={amenity}><input type="checkbox" checked={draft.amenities.includes(amenity)} onChange={event => onChange('amenities', event.target.checked ? [...draft.amenities, amenity] : draft.amenities.filter(value => value !== amenity))} />{amenity}</label>)}</div>
    </section>
    <section className={styles.section}>
      <h2>Revisão do cadastro</h2>
      <div className={styles.reviewRow}>
        <div><h3>{draft.name || 'Nome não informado'}</h3><p>{address || 'Endereço não informado'}</p><span>{draft.visibility === 'PUBLIC' ? 'Pública após aprovação' : 'Privada'} · {draft.availability.alwaysOpen ? '24 horas' : `${draft.availability.windows.length} horários de atendimento`} · {hasPosition(draft) ? 'Posição definida' : 'Posição pendente'}</span></div>
        <button type="button" className={styles.iconButton} title="Editar localização" aria-label="Editar localização" onClick={() => onEdit(0)}><Pencil size={16} aria-hidden="true" /></button>
      </div>
      <div className={styles.reviewRow}>
        <div><h3>{chargerCount} {chargerCount === 1 ? 'carregador' : 'carregadores'}</h3><p>{draft.powerLimitKw ? `${draft.powerLimitKw} kW disponíveis` : 'Potência disponível não informada'}</p><span>{solarCount} {solarCount === 1 ? 'conjunto solar' : 'conjuntos solares'} · {batteryCount} {batteryCount === 1 ? 'bateria' : 'baterias'}</span></div>
        <button type="button" className={styles.iconButton} title="Editar equipamentos" aria-label="Editar equipamentos" onClick={() => onEdit(1)}><Pencil size={16} aria-hidden="true" /></button>
      </div>
    </section>
  </>;
}
