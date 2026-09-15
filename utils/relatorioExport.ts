import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export interface RelatorioResumo {
  total_revenue?: number;
  total_orders?: number;
  open_orders?: number;
  avg_ticket?: number;
  top_dishes?: { dish_name: string; quantity_sold: number }[];
  orders_by_status?: { aberta?: number; fechada?: number; cancelada?: number };
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesParaBase64(bytes: Uint8Array): string {
  let resultado = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;
    resultado += BASE64_CHARS[(triplet >> 18) & 0x3f];
    resultado += BASE64_CHARS[(triplet >> 12) & 0x3f];
    resultado += i + 1 < len ? BASE64_CHARS[(triplet >> 6) & 0x3f] : "=";
    resultado += i + 2 < len ? BASE64_CHARS[triplet & 0x3f] : "=";
  }
  return resultado;
}

export async function exportarRelatorioExcel(resumo: RelatorioResumo, periodoLabel: string): Promise<void> {
  const status = resumo.orders_by_status || {};

  const wb = XLSX.utils.book_new();

  const linhasResumo = [
    ["Relatório — Cozinha Fast Pro"],
    ["Período", periodoLabel],
    ["Emitido em", new Date().toLocaleString("pt-BR")],
    [],
    ["Indicador", "Valor"],
    ["Faturamento Total", resumo.total_revenue ?? 0],
    ["Total de Pedidos", resumo.total_orders ?? 0],
    ["Pedidos Abertos", resumo.open_orders ?? 0],
    ["Ticket Médio", resumo.avg_ticket ?? 0],
    [],
    ["Pedidos por Status", ""],
    ["Abertas", status.aberta ?? 0],
    ["Fechadas", status.fechada ?? 0],
    ["Canceladas", status.cancelada ?? 0],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(linhasResumo);
  wsResumo["!cols"] = [{ wch: 26 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const pratos = resumo.top_dishes || [];
  const wsPratos = XLSX.utils.aoa_to_sheet([
    ["Prato", "Quantidade Vendida"],
    ...pratos.map((p) => [p.dish_name, p.quantity_sold]),
  ]);
  wsPratos["!cols"] = [{ wch: 32 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsPratos, "Pratos Mais Pedidos");

  // XLSX.write com type "array" devolve um ArrayBuffer — não é indexável direto,
  // precisa ser envolvido num Uint8Array antes de percorrer byte a byte.
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const bytes = new Uint8Array(buffer);
  const base64 = bytesParaBase64(bytes);

  const nomeArquivo = `relatorio_${Date.now()}.xlsx`;
  const uri = FileSystem.cacheDirectory + nomeArquivo;

  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const disponivel = await Sharing.isAvailableAsync();
  if (!disponivel) {
    throw new Error("Compartilhamento não está disponível neste dispositivo.");
  }

  await Sharing.shareAsync(uri, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: "Compartilhar relatório (Excel)",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
}
