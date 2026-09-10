import "react-native-reanimated";
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SystemBars } from "react-native-edge-to-edge";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { WidgetProvider } from "@/contexts/WidgetContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PratoProntoNotifier } from "@/components/PratoProntoNotifier";
import { getMesaClienteConfig } from "@/utils/mesaCliente";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [mesaClienteConfigured, setMesaClienteConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    getMesaClienteConfig().then((cfg) => setMesaClienteConfigured(!!cfg));
  }, []);

  useEffect(() => {
    if (isLoading || mesaClienteConfigured === null) return;

    const inMesaCliente = segments[0] === "(mesa-cliente)";
    const inAuthScreen = segments[0] === "auth-screen";
    const inMesaClienteSetup = segments[0] === "mesa-cliente-setup";

    // Tablets configurados em "modo mesa" pulam o login e ficam presos na tela do
    // cliente, exceto quando estão explicitamente na tela de configuração (que
    // pede login de gerente por dentro dela mesma).
    if (mesaClienteConfigured && !inMesaCliente && !inMesaClienteSetup) {
      console.log("[Layout] Tablet em modo mesa — redirecionando para (mesa-cliente)");
      router.replace("/(mesa-cliente)");
      return;
    }

    if (!mesaClienteConfigured) {
      if (!user && !inAuthScreen) {
        console.log("[Layout] No user — redirecionando para /auth-screen");
        router.replace("/auth-screen");
      } else if (user && inAuthScreen) {
        console.log("[Layout] User authenticated — redirecionando para /(tabs)/");
        router.replace("/(tabs)/");
      }
    }
  }, [user, isLoading, mesaClienteConfigured, segments, router]);

  if (isLoading || mesaClienteConfigured === null) {
    return (
      <View style={{ flex: 1, backgroundColor: "#1a1a2e", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(mesa-cliente)" options={{ headerShown: false }} />
        <Stack.Screen name="mesa-cliente-setup" options={{ headerShown: false }} />
        <Stack.Screen name="auth-screen" options={{ headerShown: false }} />
        <Stack.Screen name="auth-popup" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="prato/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="prato/novo" options={{ headerShown: false }} />
        <Stack.Screen name="prato/editar/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="categoria/index" options={{ headerShown: false }} />
        <Stack.Screen name="mesa/index" options={{ headerShown: false }} />
        <Stack.Screen name="mesa/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="mesa-historico" options={{ headerShown: false }} />
        <Stack.Screen name="usuario/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="usuario/novo" options={{ headerShown: false }} />
        <Stack.Screen name="comanda/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="comanda/nova" options={{ headerShown: false }} />
        <Stack.Screen name="comanda/comprovante" options={{ headerShown: false, headerBackVisible: false }} />
        <Stack.Screen name="pedido/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="pedido/novo" options={{ headerShown: false }} />
        <Stack.Screen name="order/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="order/new" options={{ headerShown: false }} />
        <Stack.Screen name="dish/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="dish/new" options={{ headerShown: false }} />
        <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="user/new" options={{ headerShown: false }} />
      </Stack>
      {!mesaClienteConfigured && <PratoProntoNotifier />}
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="auto" animated />
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <SafeAreaProvider>
          <WidgetProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <AuthProvider>
                <RootLayoutNav />
                <SystemBars style="auto" />
              </AuthProvider>
            </GestureHandlerRootView>
          </WidgetProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </>
  );
}
