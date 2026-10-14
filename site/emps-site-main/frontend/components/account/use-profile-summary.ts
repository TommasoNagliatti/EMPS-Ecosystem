'use client';

import { useEffect, useState } from 'react';
import { EMPS_SESSION_CHANGED_EVENT, frontSession } from '@/services/emps-api';
import { profileSummary, type ProfileSummary } from './account-model';

export function useProfileSummary() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  useEffect(() => {
    const update = () => setProfile(profileSummary(frontSession.get()));
    update();
    window.addEventListener(EMPS_SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(EMPS_SESSION_CHANGED_EVENT, update);
  }, []);
  return profile;
}
