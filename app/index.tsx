import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { loadProfile } from '../lib/storage';

export default function Index() {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => {
    loadProfile()
      .then((profile) => {
        setHasProfile(profile !== null);
      })
      .catch(() => {
        setHasProfile(false);
      });
  }, []);

  if (hasProfile === null) {
    return null;
  }

  return <Redirect href={hasProfile ? '/(tabs)' : '/onboarding'} />;
}
