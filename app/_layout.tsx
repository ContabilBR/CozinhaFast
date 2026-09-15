import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, Slot } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHAVE_ULTIMA_ROTA = 'ultima_rota_app';

function PersistenciaDeRota({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const jaRestaurou = useRef(false);

  // No boot: lê a última rota salva e navega até ela
  useEffect(() => {
    if (jaRestaurou.current) return;
    jaRestaurou.current = true;
    AsyncStorage.getItem(CHAVE_ULTIMA_ROTA)
      .then((rotaSalva) => {
        if (rotaSalva && rotaSalva !== '/') {
          router.replace(rotaSalva as any);
        }
      })
      .finally(() => setPronto(true));
  }, [router]);

  // A cada navegação: salva a rota atual
  useEffect(() => {
    if (!pronto) return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(CHAVE_ULTIMA_ROTA, pathname).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [pathname, pronto]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <PersistenciaDeRota>
      {/* aqui entram os providers/contexts que já existem no seu _layout.tsx atual */}
      <Slot />
    </PersistenciaDeRota>
  );
}
