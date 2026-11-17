import axios from 'axios';
import type {
  AddressRecord,
  DeliveryMethodId,
  LookupOrderEntry,
  OrderStatus,
  PaymentMethodId,
  PaymentStatus,
  ProductItem,
  ProductReview,
  ServiceBookingRecord,
  SpaPackage,
} from '../data/mockData';
import type { PaymentGatewayConfig, WorkspaceUserRole } from '../data/adminData';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const AUTH_TOKEN_STORAGE_KEY = 'petsfriend_auth_token';

export function setStoredAuthToken(token?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 12000,
  headers: {
    'Content-Type': 'application/json',
  },
});

http.interceptors.request.use((config) => {
  const token = getStoredAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface OnlinePaymentSessionDto {
  message: string;
  gateway: 'vnpay' | 'momo';
  environment: 'sandbox' | 'production';
  sandboxFallback?: boolean;
  orderCode: string;
  txnRef: string;
  amount: number;
  expireAt?: string;
  paymentUrl: string;
  qrScanUrl?: string;
  qrCodeUrl?: string | null;
  deeplink?: string | null;
}

export interface OrderPaymentDetailDto {
  orderCode: string;
  orderStatus: OrderStatus;
  paymentMethod: PaymentMethodId | string;
  paymentStatus: PaymentStatus;
  paymentStatusLabel: string;
  totalAmount: number;
  paidAt: string | null;
  canPayOnline: boolean;
}

export interface AuthUserDto {
  userId: number;
  username?: string | null;
  fullName: string;
  email: string;
  phone: string;
  role: 'customer' | WorkspaceUserRole;
}

export interface CreateOrderPayload {
  id?: string;
  userId?: number | null;
  isGuest?: boolean;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deliveryMethod: DeliveryMethodId;
  shippingAddress: string;
  paymentMethod: string;
  orderSource: 'online' | 'pos';
  status?: OrderStatus;
  totalAmount: number;
  staffName?: string;
  items: Array<{
    productId: string;
    name: string;
    image: string;
    variant?: string;
    price: number;
    quantity: number;
  }>;
}

export interface CreateBookingPayload {
  id?: string;
  userId?: number | null;
  packageId?: string;
  serviceName: string;
  petName: string;
  date: string;
  timeSlot: string;
  price: number;
  customerName: string;
  customerPhone: string;
  staffName?: string;
  note?: string;
}

export function getApiErrorMessage(
  err: unknown,
  fallback = 'Không thể kết nối đến máy chủ API (cổng 5000).'
): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { message?: string; error?: string }
      | undefined;
    return data?.message || data?.error || err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export const petsFriendApi = {
  // 1. Sản phẩm & Đánh giá
  getProducts: async (): Promise<ProductItem[]> => {
    const res = await http.get<ProductItem[]>('/products');
    return res.data;
  },

  createProduct: async (item: ProductItem): Promise<ProductItem> => {
    const res = await http.post<ProductItem>('/products', item);
    return res.data;
  },

  updateProduct: async (id: string, item: ProductItem): Promise<ProductItem> => {
    const res = await http.put<ProductItem>(`/products/${id}`, item);
    return res.data;
  },

  deleteProduct: async (id: string): Promise<void> => {
    await http.delete(`/products/${id}`);
  },

  addProductReview: async (
    productId: string,
    payload: {
      userId?: number | null;
      author: string;
      petTag: string;
      rating: number;
      comment: string;
    }
  ): Promise<ProductReview> => {
    const res = await http.post<ProductReview>(
      `/products/${productId}/reviews`,
      payload
    );
    return res.data;
  },

  // 2. Gói Spa & Đặt lịch chăm sóc
  getSpaPackages: async (): Promise<SpaPackage[]> => {
    const res = await http.get<SpaPackage[]>('/spa-packages');
    return res.data;
  },

  getBookings: async (params?: {
    userId?: number;
    phone?: string;
  }): Promise<ServiceBookingRecord[]> => {
    const res = await http.get<ServiceBookingRecord[]>('/service-bookings', {
      params,
    });
    return res.data;
  },

  createBooking: async (
    payload: CreateBookingPayload
  ): Promise<{ message: string; booking: ServiceBookingRecord }> => {
    const res = await http.post<{
      message: string;
      booking: ServiceBookingRecord;
    }>('/service-bookings', payload);
    return res.data;
  },

  updateBooking: async (
    id: string,
    payload: { status?: ServiceBookingRecord['status']; staffName?: string }
  ): Promise<ServiceBookingRecord> => {
    const res = await http.patch<ServiceBookingRecord>(
      `/service-bookings/${id}`,
      payload
    );
    return res.data;
  },

  // 3. Đơn hàng Online, Bán tại quầy POS & Tra cứu khách vãng lai
  getOrders: async (params?: {
    userId?: number;
  }): Promise<LookupOrderEntry[]> => {
    const res = await http.get<LookupOrderEntry[]>('/orders', { params });
    return res.data;
  },

  lookupGuestOrder: async (
    phone: string,
    orderCode: string
  ): Promise<LookupOrderEntry> => {
    const res = await http.get<LookupOrderEntry>('/orders/lookup', {
      params: { phone, orderCode },
    });
    return res.data;
  },

  createOrder: async (
    payload: CreateOrderPayload
  ): Promise<{
    message: string;
    order: LookupOrderEntry;
    payment?: {
      required: boolean;
      method: string;
      status: PaymentStatus;
      nextStep: string | null;
    };
  }> => {
    const res = await http.post<{
      message: string;
      order: LookupOrderEntry;
      payment?: {
        required: boolean;
        method: string;
        status: PaymentStatus;
        nextStep: string | null;
      };
    }>('/orders', payload);
    return res.data;
  },

  updateOrderStatus: async (
    orderCode: string,
    status: OrderStatus,
    staffName?: string
  ): Promise<LookupOrderEntry> => {
    const res = await http.patch<LookupOrderEntry>(
      `/orders/${orderCode}/status`,
      { status, staffName }
    );
    return res.data;
  },

  // 4. Xác thực, Hồ sơ cá nhân & Sổ địa chỉ
  login: async (
    identifier: string,
    password: string
  ): Promise<{
    message: string;
    token?: string;
    user: AuthUserDto;
    addresses: AddressRecord[];
  }> => {
    const res = await http.post<{
      message: string;
      token?: string;
      user: AuthUserDto;
      addresses: AddressRecord[];
    }>('/auth/login', { identifier, password });
    if (res.data.token) setStoredAuthToken(res.data.token);
    return res.data;
  },

  register: async (payload: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  }): Promise<{ message: string; token?: string; user: AuthUserDto }> => {
    const res = await http.post<{ message: string; token?: string; user: AuthUserDto }>(
      '/auth/register',
      payload
    );
    if (res.data.token) setStoredAuthToken(res.data.token);
    return res.data;
  },

  updateProfile: async (
    userId: number,
    payload: { name: string; email: string; phone: string }
  ): Promise<{ message: string; user: AuthUserDto }> => {
    const res = await http.put<{ message: string; user: AuthUserDto }>(
      `/users/${userId}/profile`,
      payload
    );
    return res.data;
  },

  getAddresses: async (userId: number): Promise<AddressRecord[]> => {
    const res = await http.get<AddressRecord[]>(`/users/${userId}/addresses`);
    return res.data;
  },

  addAddress: async (
    userId: number,
    addr: Omit<AddressRecord, 'id'>
  ): Promise<AddressRecord> => {
    const res = await http.post<AddressRecord>(
      `/users/${userId}/addresses`,
      addr
    );
    return res.data;
  },

  updateAddress: async (
    userId: number,
    addr: AddressRecord
  ): Promise<AddressRecord> => {
    const res = await http.put<AddressRecord>(
      `/users/${userId}/addresses/${addr.id}`,
      addr
    );
    return res.data;
  },

  setDefaultAddress: async (
    userId: number,
    addressId: string
  ): Promise<AddressRecord> => {
    const res = await http.patch<AddressRecord>(
      `/users/${userId}/addresses/${addressId}/default`
    );
    return res.data;
  },

  deleteAddress: async (userId: number, addressId: string): Promise<void> => {
    await http.delete(`/users/${userId}/addresses/${addressId}`);
  },

  // 5. Tin nhắn Liên hệ
  sendContactMessage: async (payload: {
    senderName: string;
    senderPhone: string;
    topic: string;
    message: string;
  }): Promise<void> => {
    await http.post('/contact-messages', payload);
  },

  // 6. Cổng thanh toán trực tuyến (VNPay QR, MoMo QR, COD)
  getPaymentGateways: async (): Promise<PaymentGatewayConfig> => {
    const res = await http.get<PaymentGatewayConfig>('/payment-gateways');
    return res.data;
  },

  updatePaymentGateways: async (
    payload: Partial<PaymentGatewayConfig>
  ): Promise<PaymentGatewayConfig & { message: string }> => {
    const res = await http.put<PaymentGatewayConfig & { message: string }>(
      '/payment-gateways',
      payload
    );
    return res.data;
  },

  createVnpayPayment: async (payload: {
    orderCode: string;
    phone?: string;
    bankCode?: string;
    returnUrl?: string;
  }): Promise<OnlinePaymentSessionDto> => {
    const res = await http.post<OnlinePaymentSessionDto>(
      '/payments/vnpay/create',
      payload
    );
    return res.data;
  },

  createMomoPayment: async (payload: {
    orderCode: string;
    phone?: string;
    redirectUrl?: string;
    sandboxFallback?: boolean;
  }): Promise<OnlinePaymentSessionDto> => {
    const res = await http.post<OnlinePaymentSessionDto>(
      '/payments/momo/create',
      payload
    );
    return res.data;
  },

  getOrderPayment: async (
    orderCode: string,
    phone?: string
  ): Promise<OrderPaymentDetailDto> => {
    const res = await http.get<OrderPaymentDetailDto>(
      `/payments/orders/${encodeURIComponent(orderCode)}`,
      { params: phone ? { phone } : undefined }
    );
    return res.data;
  },

  sandboxCompletePayment: async (
    orderCode: string,
    payload: { phone?: string; outcome?: 'success' | 'failed' }
  ): Promise<{
    message: string;
    success: boolean;
    orderCode: string;
    txnRef: string;
    order?: LookupOrderEntry;
  }> => {
    const res = await http.post<{
      message: string;
      success: boolean;
      orderCode: string;
      txnRef: string;
      order?: LookupOrderEntry;
    }>(`/payments/orders/${encodeURIComponent(orderCode)}/sandbox-complete`, payload);
    return res.data;
  },
};