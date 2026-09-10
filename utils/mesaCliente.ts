import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const MESA_CLIENTE_CONFIG_KEY = "cozinhafast_mesa_cliente_config";

export type MesaClienteConfig = {
  restauranteId: string;
  restauranteNome: string;
  mesaId: string;
  mesaNumero: number;
  configuradoEm: string;
};

export const getMesaClienteConfig = async (): Promise<MesaClienteConfig | null> => {
  try {
    let raw: string | null = null;
    if (Platform.OS === "web") {
      raw = localStorage.getItem(MESA_CLIENTE_CONFIG_KEY);
    } else {
      raw = await SecureStore.getItemAsync(MESA_CLIENTE_CONFIG_KEY);
    }
    if (!raw) return null;
    return JSON.parse(raw) as MesaClienteConfig;
  } catch (error) {
    console.error("[MesaCliente] Erro ao ler configuração:", error);
    return null;
  }
};

export const saveMesaClienteConfig = async (config: MesaClienteConfig): Promise<void> => {
  const raw = JSON.stringify(config);
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(MESA_CLIENTE_CONFIG_KEY, raw);
    } else {
      await SecureStore.setItemAsync(MESA_CLIENTE_CONFIG_KEY, raw);
    }
    console.log("[MesaCliente] Configuração salva para mesa", config.mesaNumero);
  } catch (error) {
    console.error("[MesaCliente] Erro ao salvar configuração:", error);
    throw error;
  }
};

export const clearMesaClienteConfig = async (): Promise<void> => {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(MESA_CLIENTE_CONFIG_KEY);
    } else {
      await SecureStore.deleteItemAsync(MESA_CLIENTE_CONFIG_KEY);
    }
    console.log("[MesaCliente] Configuração removida");
  } catch (error) {
    console.error("[MesaCliente] Erro ao remover configuração:", error);
  }
};
