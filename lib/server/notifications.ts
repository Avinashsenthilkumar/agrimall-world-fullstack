// lib/server/notifications.ts — in-app notifications + outbound email hooks.
//
// Notifications are written inside the caller's transaction so a seller is
// never told about an order that got rolled back. Email/SMS delivery is
// deliberately OUTSIDE the transaction (see `sendEmail`), because a slow SMTP
// handshake must not hold a database lock open.

import { prisma, type Tx } from './prisma';
import { env } from './env';
import type { NotificationType } from '@prisma/client';

export interface NotifyArgs {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}

/** Write an in-app notification. Call with the open transaction client. */
export async function notify(tx: Tx, args: NotifyArgs): Promise<void> {
  await tx.notification.create({
    data: {
      userId: args.userId,
      type: args.type,
      title: args.title.slice(0, 200),
      body: args.body?.slice(0, 1000) ?? null,
      linkUrl: args.linkUrl ?? null,
    },
  });
}

/** Outside a transaction. */
export async function notifyNow(args: NotifyArgs): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: args.userId,
      type: args.type,
      title: args.title.slice(0, 200),
      body: args.body?.slice(0, 1000) ?? null,
      linkUrl: args.linkUrl ?? null,
    },
  });
}

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
// The integration architecture is here; only credentials are pending (§1399).
// With EMAIL_DRIVER=LOG (the default) messages are logged, never silently
// swallowed, so nothing pretends to have been delivered.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean; driver: string }> {
  switch (env.EMAIL_DRIVER) {
    case 'RESEND': {
      if (!env.RESEND_API_KEY) {
        console.warn('[email] RESEND_API_KEY missing — not sent:', msg.subject);
        return { delivered: false, driver: 'RESEND(unconfigured)' };
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
      if (!res.ok) {
        console.error('[email] resend failed', res.status, await res.text().catch(() => ''));
        return { delivered: false, driver: 'RESEND' };
      }
      return { delivered: true, driver: 'RESEND' };
    }

    case 'SMTP': {
      // nodemailer is an optional dependency; install it to enable SMTP.
      if (!env.SMTP_HOST) {
        console.warn('[email] SMTP_HOST missing — not sent:', msg.subject);
        return { delivered: false, driver: 'SMTP(unconfigured)' };
      }
      try {
        const nodemailer = await import('nodemailer' as string);
        const transport = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT ?? 587,
          secure: (env.SMTP_PORT ?? 587) === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        });
        await transport.sendMail({
          from: env.EMAIL_FROM,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        });
        return { delivered: true, driver: 'SMTP' };
      } catch (err) {
        console.error('[email] smtp send failed', err);
        return { delivered: false, driver: 'SMTP' };
      }
    }

    default:
      console.info(`[email:LOG] to=${msg.to} subject="${msg.subject}"`);
      return { delivered: false, driver: 'LOG' };
  }
}

// --- Templates -------------------------------------------------------------

const shell = (title: string, body: string) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#2d2a26">
  <div style="font-size:20px;font-weight:700;color:#1C3829;margin-bottom:4px">🌿 Agri Mall</div>
  <div style="font-size:12px;color:#8a7d6f;margin-bottom:20px">Global Plant Marketplace</div>
  <h1 style="font-size:19px;color:#1C3829;margin:0 0 12px">${title}</h1>
  ${body}
  <hr style="border:none;border-top:1px solid #e8e2d9;margin:24px 0"/>
  <div style="font-size:11px;color:#8a7d6f">You received this because you have an Agri Mall account.</div>
</div>`;

export function emailVerifyTemplate(args: { name: string; verifyUrl: string }): EmailMessage {
  return {
    to: '',
    subject: 'Verify your Agri Mall email',
    html: shell(
      `Welcome, ${escapeHtml(args.name)}`,
      `<p style="font-size:14px;line-height:1.6">Please confirm your email address to activate your account.</p>
       <p><a href="${args.verifyUrl}" style="display:inline-block;background:#1C3829;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Verify email</a></p>
       <p style="font-size:12px;color:#8a7d6f">This link expires in 24 hours.</p>`,
    ),
    text: `Verify your Agri Mall email: ${args.verifyUrl}`,
  };
}

export function passwordResetTemplate(args: { name: string; resetUrl: string }): EmailMessage {
  return {
    to: '',
    subject: 'Reset your Agri Mall password',
    html: shell(
      'Reset your password',
      `<p style="font-size:14px;line-height:1.6">Hello ${escapeHtml(args.name)}, use the button below to set a new password.</p>
       <p><a href="${args.resetUrl}" style="display:inline-block;background:#1C3829;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Choose a new password</a></p>
       <p style="font-size:12px;color:#8a7d6f">This link expires in 1 hour and can be used once. If you did not request it, you can ignore this email.</p>`,
    ),
    text: `Reset your Agri Mall password: ${args.resetUrl}`,
  };
}

export function sellerApprovedTemplate(args: { businessName: string; dashboardUrl: string }): EmailMessage {
  return {
    to: '',
    subject: 'Your Agri Mall seller account is approved',
    html: shell(
      'You are approved to sell 🎉',
      `<p style="font-size:14px;line-height:1.6"><strong>${escapeHtml(args.businessName)}</strong> has been verified. You can now list products, and they will go live once approved by our catalogue team.</p>
       <p><a href="${args.dashboardUrl}" style="display:inline-block;background:#1C3829;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open seller dashboard</a></p>`,
    ),
  };
}

export function orderConfirmedTemplate(args: {
  orderNumber: string;
  total: string;
  sellerCount: number;
  orderUrl: string;
}): EmailMessage {
  return {
    to: '',
    subject: `Order ${args.orderNumber} confirmed`,
    html: shell(
      'Your order is confirmed 🌿',
      `<p style="font-size:14px;line-height:1.6">Order <strong>${args.orderNumber}</strong> · ${args.total}</p>
       <p style="font-size:14px;line-height:1.6">Your order is being fulfilled by <strong>${args.sellerCount} ${
         args.sellerCount === 1 ? 'nursery' : 'nurseries'
       }</strong>, so it will arrive in ${args.sellerCount === 1 ? 'one parcel' : 'separate parcels'} — each with its own tracking.</p>
       <p><a href="${args.orderUrl}" style="display:inline-block;background:#1C3829;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Track your order</a></p>`,
    ),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
