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

  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
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
