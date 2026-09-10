// Shared type definitions used across the app

export type UserRole = 'garcom' | 'gerente' | 'cozinheiro' | 'administrador' | 'admin';

export type TableStatus = 'disponivel' | 'ocupada' | 'reservada' | 'inativa';

export type ItemStatus = 'pendente' | 'em_preparo' | 'pronto' | 'entregue' | 'cancelado';

export type OrderStatus = 'aberta' | 'fechada' | 'cancelada';

export type PedidoStatus = 'pendente' | 'em_preparo' | 'pronto' | 'entregue' | 'cancelado';

export interface Mesa {
  id: string;
  numero: number;
  capacidade?: number;
  status: TableStatus;
  restaurante_id?: string;
}

export interface Categoria {
  id: string;
  nome: string;
  descricao?: string;
}

export interface Category {
  id: string;
  nome: string;
  descricao?: string;
}

export interface Prato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number | string;
  imagem_url?: string;
  disponivel?: boolean;
  categoria_id?: string;
  categoria?: Categoria;
}

export interface Dish {
  id: string;
  nome: string;
  descricao?: string;
  preco: number | string;
  imagem_url?: string;
  disponivel?: boolean;
  categoria_id?: string;
  categoria?: Category;
}

export interface Table {
  id: string;
  numero: number;
  capacidade?: number;
  status: TableStatus;
}

export interface OrderItem {
  id: string;
  order_id?: string;
  comanda_id?: string;
  prato_id?: string;
  dish_id?: string;
  quantidade: number;
  preco_unitario: number | string;
  observacao?: string;
  status: ItemStatus;
}

export interface Order {
  id: string;
  mesa_id?: string;
  mesa_numero?: number;
  status: OrderStatus;
  total?: number | string;
  created_at?: string;
  closed_at?: string;
  garcom_nome?: string;
  pedidos?: OrderItem[];
}

export interface Pedido {
  id: string;
  comanda_id: string;
  prato_id: string;
  quantidade: number;
  preco_unitario: number | string;
  observacao?: string;
  status: PedidoStatus;
}

export interface RelatorioResumo {
  total_comandas?: number;
  total_pedidos?: number;
  faturamento_total?: number | string;
  ticket_medio?: number | string;
  pedidos_por_status?: Record<string, number>;
  pratos_mais_pedidos?: { nome: string; quantidade: number }[];
}
