import { LogoMark } from '@/components/ui/Logo';

export function BrandLogo({ size = 40 }: { size?: number; priority?: boolean }) {
  return <LogoMark size={size} className="lp-brand-mark" />;
}
