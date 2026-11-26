import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';
import type { LookupOrderEntry } from '../data/mockData';
import type { ThemeMode } from '../lib/useThemeDroplet';
import {
  getApiErrorMessage,
  petsFriendApi,
  type OnlinePaymentSessionDto,
} from '../services/petsFriendApi';
import { useModalFocusTrap } from '../lib/useModalFocusTrap';
import { QrCodeSvg } from './QrCodeSvg';

interface PaymentQrModalProps {
  session: OnlinePaymentSessionDto | null;
  customerPhone: string;
  customerName: string;
  theme?: ThemeMode;
  onPaid: (updatedOrder?: LookupOrderEntry) => void;
  onFailed: (reason: string, updatedOrder?: LookupOrderEntry) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const PaymentQrModal: React.FC<PaymentQrModalProps> = ({
  session,
  customerPhone,
  customerName,
  theme,
  onPaid,
  onFailed,
  onClose,
  onNotify,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(Boolean(session), onClose, modalRef);

  const [secondsLeft, setSecondsLeft] = useState<number>(900);
  const [submittingAction, setSubmittingAction] = useState<'confirm' | 'cancel' | null>(null);

  const isDark =
    theme !== undefined
      ? theme === 'dark'
      : typeof document !== 'undefined' &&
        document.documentElement.getAttribute('data-theme') === 'dark';

  const isMomo = session?.gateway === 'momo';
  const brandColor = isMomo ? '#a50064' : '#005baa';
  const accentTextColor = isDark ? (isMomo ? '#f472b6' : '#60a5fa') : brandColor;
  const gatewayLabel = isMomo ? 'Ví điện tử MoMo' : 'VNPay QR';
  const badgeLabel = isMomo ? 'MoMo' : 'VNPAY';

  const qrPayload = useMemo(() => {
    if (!session) return '';
    if (session.gateway === 'momo' && session.qrCodeUrl) {
      return session.qrCodeUrl;
    }
    return session.qrScanUrl || session.paymentUrl;
  }, [session]);

  const hasExternalGatewayUrl = Boolean(
    session?.paymentUrl && /^https:\/\//i.test(session.paymentUrl)
  );

  // Đồng hồ đếm ngược thời hạn hiệu lực mã QR (mặc định 15 phút)
  useEffect(() => {
    if (!session) return undefined;
    const targetMs = session.expireAt
      ? new Date(session.expireAt).getTime()
      : Date.now() + 15 * 60 * 1000;

    const updateRemaining = () => {
      const diff = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff <= 0) {
        onFailed('Hết thời gian hiệu lực của mã QR thanh toán');
      }
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [session, onFailed]);

  // Tự động kiểm tra trạng thái thanh toán định kỳ (nếu khách quét QR bằng điện thoại hoặc thanh toán ở tab cổng)
  useEffect(() => {
    if (!session) return undefined;
    let active = true;

    const pollInterval = window.setInterval(async () => {
      try {
        const detail = await petsFriendApi.getOrderPayment(session.orderCode, customerPhone);
        if (!active) return;
        if (detail.paymentStatus === 'paid') {
          window.clearInterval(pollInterval);
          onPaid();
        } else if (detail.paymentStatus === 'failed') {
          window.clearInterval(pollInterval);
          onFailed('Giao dịch từ cổng thanh toán không thành công');
        }
      } catch {
        // Bỏ qua lỗi mạng tạm thời trong lúc chờ quét mã
      }
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(pollInterval);
    };
  }, [session, customerPhone, onPaid, onFailed]);

  if (!session) return null;

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const secs = String(secondsLeft % 60).padStart(2, '0');
  const transferContent = `Thanh toan don hang ${session.orderCode}`;

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onNotify(`Đã sao chép ${label}.`);
    } catch {
      onNotify(`${label}: ${value}`);
    }
  };

  const handleSandboxOutcome = async (outcome: 'success' | 'failed') => {
    setSubmittingAction(outcome === 'success' ? 'confirm' : 'cancel');
    try {
      const res = await petsFriendApi.sandboxCompletePayment(session.orderCode, {
        phone: customerPhone,
        outcome,
      });
      if (outcome === 'success' && res.success) {
        onPaid(res.order);
      } else {
        onFailed('Khách hàng đã hủy giao dịch thanh toán QR', res.order);
      }
    } catch (err) {
      if (outcome === 'failed') {
        onFailed('Khách hàng đã hủy giao dịch thanh toán QR');
      } else {
        onNotify(getApiErrorMessage(err, 'Không thể xác nhận giao dịch lúc này.'));
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-qr-modal-title"
        className={`w-full max-w-[720px] rounded-2xl border shadow-2xl overflow-hidden my-auto ${
          isDark ? 'bg-[#111827] border-white/10' : 'bg-white border-[#dfe6f0]'
        }`}
      >
        {/* Top Branded Header */}
        <div
          className="px-6 py-4 text-white flex items-center justify-between gap-3"
          style={{ backgroundColor: brandColor }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="px-2.5 py-1 rounded-lg bg-white/15 border border-white/25 text-[12px] font-extrabold tracking-wide shrink-0">
              {badgeLabel}
            </div>
            <div className="min-w-0">
              <h2 id="payment-qr-modal-title" className="text-[16px] font-extrabold truncate">
                Quét mã QR thanh toán qua {gatewayLabel}
              </h2>
              <p className="text-[12px] text-white/85 truncate">
                Đơn hàng #{session.orderCode} · Môi trường{' '}
                {session.environment === 'production' ? 'Production' : 'Sandbox kiểm thử'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="px-2.5 py-1 rounded-full bg-white/15 text-[12px] font-extrabold tabular-nums inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {mins}:{secs}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng cửa sổ QR"
              className="p-1.5 rounded-lg hover:bg-white/15 text-white cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Left Column: Scannable QR Box */}
          <div className="md:col-span-5 flex flex-col items-center">
            <div
              className="relative p-3.5 rounded-2xl border-2 shadow-sm"
              style={{
                backgroundColor: '#ffffff',
                borderColor: isDark
                  ? 'rgba(255, 255, 255, 0.16)'
                  : isMomo
                    ? '#f5c2df'
                    : '#c8ddf8',
              }}
            >
              {/* 4 Corner Scan Brackets */}
              <span
                className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 rounded-tl-lg pointer-events-none"
                style={{ borderColor: brandColor }}
              />
              <span
                className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 rounded-tr-lg pointer-events-none"
                style={{ borderColor: brandColor }}
              />
              <span
                className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 rounded-bl-lg pointer-events-none"
                style={{ borderColor: brandColor }}
              />
              <span
                className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 rounded-br-lg pointer-events-none"
                style={{ borderColor: brandColor }}
              />

              <QrCodeSvg
                value={qrPayload}
                size={208}
                darkColor="#17324d"
                badgeText={badgeLabel}
                badgeColor={brandColor}
                ariaLabel={`Mã QR thanh toán ${gatewayLabel} cho đơn ${session.orderCode}`}
              />
            </div>

            <div className="mt-3.5 w-full text-center space-y-1">
              <div
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap text-[12px] font-bold ${
                  isDark ? 'text-slate-100' : 'text-[#17324d]'
                }`}
              >
                <Smartphone
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: accentTextColor }}
                />
                <span>
                  {isMomo
                    ? 'Mở ứng dụng MoMo → Quét mã'
                    : 'Mở App Ngân hàng / VNPay → Quét QR'}
                </span>
              </div>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-[#52657a]'}`}>
                Hệ thống tự động cập nhật ngay sau khi nhận thanh toán
              </p>
            </div>
          </div>

          {/* Right Column: Order Info & Actions */}
          <div className="md:col-span-7 space-y-4">
            <div
              className={`rounded-xl border p-4 space-y-2.5 text-[12.5px] ${
                isDark
                  ? 'bg-[#0B0F19] border-white/10'
                  : 'bg-[#f8faff] border-[#dfe6f0]'
              }`}
            >
              <div
                className={`flex items-baseline justify-between gap-2 pb-2.5 border-b ${
                  isDark ? 'border-white/10' : 'border-[#dfe6f0]'
                }`}
              >
                <span className={`font-semibold ${isDark ? 'text-slate-400' : 'text-[#52657a]'}`}>
                  Số tiền thanh toán
                </span>
                <span
                  className="text-[22px] font-extrabold tabular-nums"
                  style={{ color: accentTextColor }}
                >
                  {session.amount.toLocaleString('vi-VN')}₫
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className={isDark ? 'text-slate-400' : 'text-[#52657a]'}>
                  Đơn vị thụ hưởng
                </span>
                <strong className={isDark ? 'text-slate-100' : 'text-[#17324d]'}>
                  PETSFRIEND STORE
                </strong>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className={isDark ? 'text-slate-400' : 'text-[#52657a]'}>Khách hàng</span>
                <strong
                  className={`truncate max-w-[220px] ${
                    isDark ? 'text-slate-100' : 'text-[#17324d]'
                  }`}
                >
                  {customerName || 'Quý khách'}
                </strong>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className={isDark ? 'text-slate-400' : 'text-[#52657a]'}>Mã giao dịch</span>
                <button
                  type="button"
                  onClick={() => handleCopy(session.txnRef, 'mã giao dịch')}
                  className={`inline-flex items-center gap-1 font-mono font-bold cursor-pointer transition-colors ${
                    isDark
                      ? 'text-slate-200 hover:text-[#60a5fa]'
                      : 'text-[#17324d] hover:text-[#0667d0]'
                  }`}
                >
                  <span>{session.txnRef}</span>
                  <Copy className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-[#52657a]'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className={isDark ? 'text-slate-400' : 'text-[#52657a]'}>Nội dung</span>
                <button
                  type="button"
                  onClick={() => handleCopy(transferContent, 'nội dung thanh toán')}
                  className={`inline-flex items-center gap-1 font-bold hover:underline cursor-pointer ${
                    isDark ? 'text-[#60a5fa]' : 'text-[#0667d0]'
                  }`}
                >
                  <span>{transferContent}</span>
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {session.environment === 'sandbox' && (
              <div
                className={`rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 flex items-start gap-2.5 text-[11.5px] leading-relaxed ${
                  isDark ? 'text-emerald-300' : 'text-emerald-800'
                }`}
              >
                <ShieldCheck
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    isDark ? 'text-emerald-400' : 'text-emerald-600'
                  }`}
                />
                <span>
                  <strong className={isDark ? 'text-emerald-200' : 'text-emerald-900'}>
                    Chế độ Sandbox kiểm thử:
                  </strong>{' '}
                  Bạn có thể quét mã QR hoặc bấm nút{' '}
                  <strong className={isDark ? 'text-emerald-200' : 'text-emerald-900'}>
                    Xác nhận đã quét QR
                  </strong>{' '}
                  bên dưới để chốt giao dịch vào SQL Server.
                </span>
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              {session.environment === 'sandbox' && (
                <button
                  type="button"
                  disabled={submittingAction !== null}
                  onClick={() => handleSandboxOutcome('success')}
                  className="w-full py-3 px-4 rounded-xl text-white text-[13.5px] font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95 disabled:opacity-60"
                  style={{ backgroundColor: brandColor }}
                >
                  {submittingAction === 'confirm' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Tôi đã quét mã QR · Xác nhận thanh toán</span>
                </button>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {hasExternalGatewayUrl && (
                  <a
                    href={session.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`py-2.5 px-3 rounded-xl border text-[12px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                      isDark
                        ? 'border-white/10 bg-[#0B0F19] text-slate-200 hover:border-[#60a5fa] hover:text-[#60a5fa]'
                        : 'border-[#dfe6f0] hover:border-[#0667d0] bg-white text-[#17324d] hover:text-[#0667d0]'
                    }`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở cổng {badgeLabel} Web</span>
                  </a>
                )}

                <button
                  type="button"
                  disabled={submittingAction !== null}
                  onClick={() => handleSandboxOutcome('failed')}
                  className={`py-2.5 px-3 rounded-xl border text-[12px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 ${
                    isDark
                      ? 'border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                      : 'border-rose-200 hover:bg-rose-50 text-rose-700'
                  } ${hasExternalGatewayUrl ? '' : 'sm:col-span-2'}`}
                >
                  {submittingAction === 'cancel' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  <span>Hủy giao dịch</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
