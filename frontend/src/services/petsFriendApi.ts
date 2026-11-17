import axios from 'axios';
import type {
  AddressRecord,
  DeliveryMethodId,
  LookupOrderEntry,
  OrderStatus,
  ProductItem,
  ProductReview,
  ServiceBookingRecord,
  SpaPackage,
} from '../data/mockData';
import type { WorkspaceUserRole } from '../data/adminData';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 12000,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
  ): Promise<{ message: string; order: LookupOrderEntry }> => {
    const res = await http.post<{ message: string; order: LookupOrderEntry }>(
      '/orders',
      payload
    );
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
    user: AuthUserDto;
    addresses: AddressRecord[];
  }> => {
    const res = await http.post<{
      message: string;
      user: AuthUserDto;
      addresses: AddressRecord[];
    }>('/auth/login', { identifier, password });
    return res.data;
  },

  register: async (payload: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  }): Promise<{ message: string; user: AuthUserDto }> => {
    const res = await http.post<{ message: string; user: AuthUserDto }>(
      '/auth/register',
      payload
    );
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
};