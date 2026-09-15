import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { formatCurrency } from "@/utils/helpers";

export interface RelatorioResumo {
  total_revenue?: number;
  total_orders?: number;
  open_orders?: number;
  avg_ticket?: number;
  top_dishes?: { dish_name: string; quantity_sold: number }[];
  orders_by_status?: { aberta?: number; fechada?: number; cancelada?: number };
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function compartilhar(uri: string, mimeType: string, dialogTitle: string, uti: string) {
  const disponivel = await Sharing.isAvailableAsync();
  if (!disponivel) {
    throw new Error("Compartilhamento não está disponível neste dispositivo.");
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI: uti });
}

// ---------- Excel ----------

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

  await compartilhar(
    uri,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Compartilhar relatório (Excel)",
    "org.openxmlformats.spreadsheetml.sheet"
  );
}

// ---------- PDF ----------

function montarHtmlRelatorio(resumo: RelatorioResumo, periodoLabel: string): string {
  const status = resumo.orders_by_status || {};
  const pratos = resumo.top_dishes || [];

  const linhasPratos = pratos
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.dish_name)}</td><td style="text-align:right">${p.quantity_sold}</td></tr>`
    )
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #1a1a1a; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { font-size: 15px; margin-top: 24px; }
          .subtitulo { color: #666; font-size: 13px; margin-bottom: 24px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 13px; text-align: left; }
          th { background: #f5f5f5; }
          .kpis { display: flex; flex-wrap: wrap; gap: 12px; }
          .kpi { flex: 1; min-width: 120px; border: 1px solid #eee; border-radius: 8px; padding: 12px; }
          .kpi .valor { font-size: 18px; font-weight: 700; }
          .kpi .rotulo { font-size: 11px; color: #666; }
        </style>
      </head>
      <body>
        <h1>Relatório — Cozinha Fast Pro</h1>
        <div class="subtitulo">Período: ${escapeHtml(periodoLabel)} · Emitido em ${new Date().toLocaleString("pt-BR")}</div>

        <div class="kpis">
          <div class="kpi"><div class="valor">${formatCurrency(resumo.total_revenue ?? 0)}</div><div class="rotulo">Faturamento Total</div></div>
          <div class="kpi"><div class="valor">${resumo.total_orders ?? 0}</div><div class="rotulo">Total de Pedidos</div></div>
          <div class="kpi"><div class="valor">${resumo.open_orders ?? 0}</div><div class="rotulo">Pedidos Abertos</div></div>
          <div class="kpi"><div class="valor">${formatCurrency(resumo.avg_ticket ?? 0)}</div><div class="rotulo">Ticket Médio</div></div>
        </div>

        <h2>Pedidos por Status</h2>
        <table>
          <tr><th>Status</th><th style="text-align:right">Quantidade</th></tr>
          <tr><td>Abertas</td><td style="text-align:right">${status.aberta ?? 0}</td></tr>
          <tr><td>Fechadas</td><td style="text-align:right">${status.fechada ?? 0}</td></tr>
          <tr><td>Canceladas</td><td style="text-align:right">${status.cancelada ?? 0}</td></tr>
        </table>

        <h2>Pratos Mais Pedidos</h2>
        <table>
          <tr><th>Prato</th><th style="text-align:right">Qtd. Vendida</th></tr>
          ${linhasPratos || '<tr><td colspan="2">Sem dados disponíveis</td></tr>'}
        </table>
      </body>
    </html>
  `;
}

export async function exportarRelatorioPDF(resumo: RelatorioResumo, periodoLabel: string): Promise<void> {
  const RNHTMLtoPDF = (await import("react-native-html-to-pdf")).default;
  const html = montarHtmlRelatorio(resumo, periodoLabel);
  const result = await RNHTMLtoPDF.convert({ html, fileName: "relatorio", base64: false });
  const uri = result.filePath ?? "";

  await compartilhar(uri, "application/pdf", "Compartilhar relatório (PDF)", "com.adobe.pdf");
}
