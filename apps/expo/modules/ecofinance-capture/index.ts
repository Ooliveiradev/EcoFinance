import { requireOptionalNativeModule } from 'expo';

/** A notice kept in the device's private queue until the server acknowledges it (#19). */
export interface CapturedNotice { id: string; package: string; key: string; postedAt: string; title: string | null; text: string }
export interface CaptureStatus { owner: string | null; packages: string[]; queued: number; dropped: number; lastEventAt: number | null; connected: boolean }
export interface CaptureNative {
  isAccessGranted(): boolean;
  openAccessSettings(): void;
  configure(owner: string | null, packages: string[]): void;
  peek(limit: number): CapturedNotice[];
  remove(ids: string[]): void;
  clear(): void;
  status(): CaptureStatus;
}
/** Android only. iOS, web and tests get null: other apps' notifications are not readable there. */
export const captureNative = requireOptionalNativeModule<CaptureNative>('EcoFinanceCapture');
