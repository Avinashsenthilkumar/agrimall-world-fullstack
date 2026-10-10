// A status chip that understands the full marketplace status vocabulary and
// maps it onto the pill classes already defined in globals.css.
'use client';
import { statusPillClass, humanise } from '../lib/client/format';

export default function StatusPill({ status, label }: { status: string; label?: string }) {
  if (!status) return null;
  return <span className={`spill ${statusPillClass(status)}`}>{label ?? humanise(status)}</span>;
}
