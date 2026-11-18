import React, { useMemo } from 'react';
import { encodeQrMatrix } from '../lib/qrEncoder';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  darkColor?: string;
  badgeText?: string;
  badgeColor?: string;
  className?: string;
  ariaLabel?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({
  value,
  size = 200,
  darkColor = '#17324d',
  badgeText,
  badgeColor = '#0667d0',
  className = '',
  ariaLabel = 'Mã QR thanh toán',
}) => {
  const { matrixSize, pathData } = useMemo(() => {
    const matrix = encodeQrMatrix(value || 'PETSFRIEND');
    const n = matrix.length;
    const chunks: string[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          chunks.push(`M${c},${r}h1v1h-1z`);
        }
      }
    }
    return { matrixSize: n, pathData: chunks.join('') };
  }, [value]);

  const quietZone = 3;
  const viewSize = matrixSize + quietZone * 2;
  const badgeWidth = Math.max(6, Math.round(matrixSize * 0.24));
  const badgeHeight = Math.max(3.6, Math.round(matrixSize * 0.14 * 10) / 10);
  const badgeX = quietZone + (matrixSize - badgeWidth) / 2;
  const badgeY = quietZone + (matrixSize - badgeHeight) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      role="img"
      aria-label={ariaLabel}
      shapeRendering="crispEdges"
      className={`select-none ${className}`}
    >
      <rect width={viewSize} height={viewSize} rx={2} fill="#ffffff" />
      <g transform={`translate(${quietZone}, ${quietZone})`}>
        <path d={pathData} fill={darkColor} />
      </g>
      {badgeText && (
        <g shapeRendering="geometricPrecision">
          <rect
            x={badgeX - 0.5}
            y={badgeY - 0.5}
            width={badgeWidth + 1}
            height={badgeHeight + 1}
            rx={1.4}
            fill="#ffffff"
          />
          <rect
            x={badgeX}
            y={badgeY}
            width={badgeWidth}
            height={badgeHeight}
            rx={1.1}
            fill={badgeColor}
          />
          <text
            x={quietZone + matrixSize / 2}
            y={quietZone + matrixSize / 2 + badgeHeight * 0.24}
            textAnchor="middle"
            fill="#ffffff"
            fontSize={badgeHeight * 0.52}
            fontWeight="800"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {badgeText}
          </text>
        </g>
      )}
    </svg>
  );
};
