// @ts-expect-error no type declarations for react-native-html-to-pdf
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export interface ReportData {
  periodoLabel: string;
  receitaPeriodo: number;
  avgTicket: number;
  totalPedidos?: number;
  pedidosAbertos?: number;
  topDishes: { dish_name: string; quantity_sold: number }[];
  ordersByStatus: { aberta?: number; fechada?: number; cancelada?: number };
  generatedAt?: string;
}

function formatBRL(value: number): string {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTimeBR(isoString: string): string {
  const d = new Date(isoString);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function buildHTML(data: ReportData): string {
  const generatedAt = data.generatedAt || new Date().toISOString();
  const generatedAtStr = formatDateTimeBR(generatedAt);
  const receitaStr = formatBRL(data.receitaPeriodo);
  const avgTicketStr = formatBRL(data.avgTicket);

  const topDishesRows = data.topDishes.length === 0
    ? '<p style="color:#94A3B8;font-size:14px;margin:0;">Sem dados disponíveis</p>'
    : data.topDishes.map((dish, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #2a2a4a;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:28px;height:28px;border-radius:8px;background:#e9456018;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-weight:700;font-size:13px;color:#e94560;">${i + 1}</div>
          <span style="font-size:14px;color:#e2e8f0;">${dish.dish_name}</span>
        </div>
        <span style="font-size:14px;font-weight:700;color:#e94560;">${dish.quantity_sold}x</span>
      </div>
    `).join('');

  const aberta = data.ordersByStatus.aberta ?? 0;
  const fechada = data.ordersByStatus.fechada ?? 0;
  const cancelada = data.ordersByStatus.cancelada ?? 0;

  const totalPedidosRow = data.totalPedidos !== undefined
    ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #2a2a4a;">
        <span style="font-size:14px;color:#94A3B8;">Total de Pedidos</span>
        <span style="font-size:16px;font-weight:700;color:#e2e8f0;">${data.totalPedidos}</span>
      </div>`
    : '';

  const pedidosAbertosRow = data.pedidosAbertos !== undefined
    ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #2a2a4a;">
        <span style="font-size:14px;color:#94A3B8;">Pedidos Abertos</span>
        <span style="font-size:16px;font-weight:700;color:#F59E0B;">${data.pedidosAbertos}</span>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório CozinhaFast Pro</title>
</head>
<body style="margin:0;padding:0;background-color:#1a1a2e;font-family:sans-serif;color:#e2e8f0;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#16213e 0%,#0f3460 100%);padding:32px 28px 24px;border-bottom:3px solid #e94560;">
    <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">CozinhaFast Pro</div>
    <div style="font-size:16px;color:#e94560;font-weight:600;margin-top:6px;">${data.periodoLabel}</div>
    <div style="font-size:12px;color:#64748b;margin-top:8px;">Gerado em: ${generatedAtStr}</div>
  </div>

  <!-- Content -->
  <div style="padding:24px 28px;display:flex;flex-direction:column;gap:24px;">

    <!-- Resumo Financeiro -->
    <div>
      <div style="font-size:18px;font-weight:700;color:#ffffff;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e94560;">
        Resumo Financeiro
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;background:#16213e;border-radius:12px;padding:16px;border:1px solid #2a2a4a;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Receita no Período</div>
          <div style="font-size:22px;font-weight:900;color:#22C55E;">${receitaStr}</div>
        </div>
        <div style="flex:1;min-width:140px;background:#16213e;border-radius:12px;padding:16px;border:1px solid #2a2a4a;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Ticket Médio</div>
          <div style="font-size:22px;font-weight:900;color:#3B82F6;">${avgTicketStr}</div>
        </div>
      </div>
      ${totalPedidosRow || pedidosAbertosRow ? `
      <div style="background:#16213e;border-radius:12px;padding:4px 16px;border:1px solid #2a2a4a;margin-top:14px;">
        ${totalPedidosRow}
        ${pedidosAbertosRow}
      </div>` : ''}
    </div>

    <!-- Pedidos por Status -->
    <div>
      <div style="font-size:18px;font-weight:700;color:#ffffff;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e94560;">
        Pedidos por Status
      </div>
      <div style="background:#16213e;border-radius:12px;padding:4px 16px;border:1px solid #2a2a4a;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #2a2a4a;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#22C55E;"></div>
            <span style="font-size:14px;color:#e2e8f0;">Abertas</span>
          </div>
          <span style="font-size:18px;font-weight:700;color:#22C55E;">${aberta}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #2a2a4a;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#94A3B8;"></div>
            <span style="font-size:14px;color:#e2e8f0;">Fechadas</span>
          </div>
          <span style="font-size:18px;font-weight:700;color:#94A3B8;">${fechada}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:10px;height:10px;border-radius:50%;background:#EF4444;"></div>
            <span style="font-size:14px;color:#e2e8f0;">Canceladas</span>
          </div>
          <span style="font-size:18px;font-weight:700;color:#EF4444;">${cancelada}</span>
        </div>
      </div>
    </div>

    <!-- Pratos Mais Vendidos -->
    <div>
      <div style="font-size:18px;font-weight:700;color:#ffffff;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e94560;">
        Pratos Mais Vendidos
      </div>
      <div style="background:#16213e;border-radius:12px;padding:4px 16px;border:1px solid #2a2a4a;">
        ${topDishesRows}
      </div>
    </div>

  </div>

  <!-- Footer -->
  <div style="padding:20px 28px;border-top:1px solid #2a2a4a;text-align:center;">
    <div style="font-size:12px;color:#64748b;">Relatório gerado pelo CozinhaFast Pro</div>
  </div>

</body>
</html>`;
}

export async function exportRelatorioPDF(data: ReportData): Promise<void> {
  console.log('[reportPdf] exportRelatorioPDF called with periodoLabel:', data.periodoLabel);
  try {
    const html = buildHTML(data);
    console.log('[reportPdf] HTML built, calling RNHTMLtoPDF.convert (base64)');
    const result = await RNHTMLtoPDF.convert({
      html,
      fileName: 'relatorio_cozinhafast',
      base64: true,
    });
    if (!result?.base64) {
      throw new Error('Arquivo PDF não foi criado (base64 vazio).');
    }

    const uri = FileSystem.cacheDirectory + `relatorio_cozinhafast_${Date.now()}.pdf`;
    await FileSystem.writeAsStringAsync(uri, result.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    console.log('[reportPdf] PDF gravado em:', uri);

    const canShare = await Sharing.isAvailableAsync();
    console.log('[reportPdf] Sharing available:', canShare);
    if (!canShare) {
      throw new Error('Compartilhamento não está disponível neste dispositivo.');
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Compartilhar Relatório',
    });
    console.log('[reportPdf] Share sheet opened');
  } catch (e: any) {
    console.error('[reportPdf] Error generating PDF:', e instanceof Error ? e.message : String(e));
    throw new Error(e?.message || 'Não foi possível gerar o relatório em PDF.');
  }
}
