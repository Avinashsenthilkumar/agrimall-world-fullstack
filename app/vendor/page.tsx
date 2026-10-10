// The v1 "Regional Vendor" page is gone — its job is now split between the
// seller dashboard (fulfilment) and the logistics console (courier scans).
// Anyone with the old bookmark is sent somewhere useful rather than a 404.
import { redirect } from 'next/navigation';

export default function VendorRedirect() {
  redirect('/logistics');
}
