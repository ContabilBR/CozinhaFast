import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { formatCurrency } from "@/utils/helpers";

export interface RelatorioResumo {
  total_revenue?: number;
  receita_periodo?: number;
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

function formatPct(n: number, total: number): string {
  if (total <= 0) return "0,0%";
  return `${((n / total) * 100).toFixed(1).replace(".", ",")}%`;
}

export async function exportarRelatorioExcel(resumo: RelatorioResumo, periodoLabel: string): Promise<void> {
  const status = resumo.orders_by_status || {};
  const pedidosNoPeriodo = (status.aberta ?? 0) + (status.fechada ?? 0) + (status.cancelada ?? 0);
  const pratos = resumo.top_dishes || [];
  const totalItensVendidos = pratos.reduce((soma, p) => soma + (p.quantity_sold || 0), 0);

  const wb = XLSX.utils.book_new();

  const linhasResumo = [
    ["Relatório — Cozinha Fast Pro"],
    ["Período", periodoLabel],
    ["Emitido em", new Date().toLocaleString("pt-BR")],
    [],
    ["RESUMO DO PERÍODO SELECIONADO", ""],
    ["Faturamento no Período", formatCurrency(resumo.receita_periodo ?? 0)],
    ["Pedidos no Período", pedidosNoPeriodo],
    ["Ticket Médio", formatCurrency(resumo.avg_ticket ?? 0)],
    ["Pedidos Abertos Atualmente", resumo.open_orders ?? 0],
    [],
    ["PEDIDOS POR STATUS NO PERÍODO", "", "% do período"],
    ["Abertas", status.aberta ?? 0, formatPct(status.aberta ?? 0, pedidosNoPeriodo)],
    ["Fechadas", status.fechada ?? 0, formatPct(status.fechada ?? 0, pedidosNoPeriodo)],
    ["Canceladas", status.cancelada ?? 0, formatPct(status.cancelada ?? 0, pedidosNoPeriodo)],
    [],
    ["HISTÓRICO GERAL (desde o início)", ""],
    ["Faturamento Total Histórico", formatCurrency(resumo.total_revenue ?? 0)],
    ["Total de Pedidos Histórico", resumo.total_orders ?? 0],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(linhasResumo);
  wsResumo["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const linhasPratos = [
    ["Prato", "Quantidade Vendida", "% do total de itens"],
    ...pratos.map((p) => [
      p.dish_name,
      p.quantity_sold,
      formatPct(p.quantity_sold, totalItensVendidos),
    ]),
  ];
  if (pratos.length === 0) {
    linhasPratos.push(["Sem dados disponíveis para este período", "", ""]);
  }
  const wsPratos = XLSX.utils.aoa_to_sheet(linhasPratos);
  wsPratos["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 16 }];
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
