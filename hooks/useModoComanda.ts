import { useState, useEffect } from "react";
import { apiGet } from "@/utils/api";

type ModoComanda = "mesa" | "individual";
let cachedModo: ModoComanda | null = null;
let fetchPromise: Promise<ModoComanda> | null = null;

async function fetchModo(): Promise<ModoComanda> {
  if (cachedModo) return cachedModo;
  if (!fetchPromise) {
    fetchPromise = apiGet<any>("/api/restaurante/modo-comanda")
      .then((res) => {
        const m = res?.modo_comanda === "individual" ? "individual" : "mesa";
        cachedModo = m;
        console.log("[useModoComanda] GET /api/restaurante/modo-comanda — modo:", m);
        return m;
      })
      .catch((err) => {
        console.warn("[useModoComanda] Falha ao buscar modo-comanda, usando 'mesa':", err);
        fetchPromise = null; // allow retry next mount
        return "mesa" as ModoComanda;
      });
  }
  return fetchPromise;
}

export default function useModoComanda() {
  const [modo, setModo] = useState<ModoComanda>(cachedModo ?? "mesa");
  const [loading, setLoading] = useState(!cachedModo);

  useEffect(() => {
    if (cachedModo) return;
    fetchModo().then((m) => {
      setModo(m);
      setLoading(false);
    });
  }, []);

  return { modo, loading };
}
