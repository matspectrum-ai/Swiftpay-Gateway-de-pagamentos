import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { App as BaseApp } from './app-base.js';
import {
  createPaymentLink,
  DashboardApiError,
  disablePaymentLink,
  listContexts,
  listPaymentLinks,
  type DashboardEnvironment,
  type MerchantContext,
  type PaymentLink,
} from './api.js';
import { currentSession, refreshSession, signOut } from './auth.js';

function money(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function date(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function withSessionRetry<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
  const session = await currentSession();
  if (!session) throw new DashboardApiError('session');
  try {
    return await operation(session.access_token);
  } catch (error) {
    if (!(error instanceof DashboardApiError) || error.category !== 'session') throw error;
    const refreshed = await refreshSession();
    if (!refreshed) throw error;
    return operation(refreshed.access_token);
  }
}

function PaymentLinksView() {
  const [contexts, setContexts] = useState<readonly MerchantContext[]>([]);
  const [merchantId, setMerchantId] = useState('');
  const [environment, setEnvironment] = useState<DashboardEnvironment>('sandbox');
  const [links, setLinks] = useState<readonly PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expiration, setExpiration] = useState('60');

  const selectedContext = useMemo(
    () => contexts.find((item) => item.merchantId === merchantId) ?? null,
    [contexts, merchantId],
  );
  const canMutate = selectedContext?.membershipRole === 'admin' || selectedContext?.membershipRole === 'owner';

  useEffect(() => {
    let active = true;
    void withSessionRetry((token) => listContexts(token))
      .then((items) => {
        if (!active) return;
        setContexts(items);
        setMerchantId(items[0]?.merchantId ?? '');
        setLoading(false);
      })
      .catch(() => { if (active) { setError('Não foi possível carregar seus merchants.'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  async function reload(targetMerchant = merchantId, targetEnvironment = environment) {
    if (!targetMerchant) { setLinks([]); return; }
    setLoading(true);
    setError(null);
    try {
      const items = await withSessionRetry((token) => listPaymentLinks({
        accessToken: token,
        merchantId: targetMerchant,
        environment: targetEnvironment,
      }));
      setLinks(items);
    } catch {
      setError('Não foi possível carregar os links de pagamento.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (merchantId) void reload(merchantId, environment);
  }, [merchantId, environment]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate || environment === 'production' || mutating) return;
    const amountCents = Number(amount);
    const expirationMinutes = Number(expiration);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1
        || !Number.isSafeInteger(expirationMinutes) || expirationMinutes < 5 || expirationMinutes > 1440) {
      setError('Informe valor em centavos e expiração entre 5 e 1440 minutos.');
      return;
    }
    setMutating(true);
    setError(null);
    const key = crypto.randomUUID();
    try {
      await withSessionRetry((token) => createPaymentLink({
        accessToken: token,
        merchantId,
        environment,
        idempotencyKey: key,
        amount: amountCents,
        ...(description === '' ? {} : { description }),
        pixExpirationMinutes: expirationMinutes,
      }));
      setAmount('');
      setDescription('');
      await reload();
    } catch {
      setError('Não foi possível criar o link de pagamento.');
    } finally {
      setMutating(false);
    }
  }

  async function disable(link: PaymentLink) {
    if (!canMutate || environment === 'production' || link.status !== 'active' || mutating) return;
    setMutating(true);
    setError(null);
    const key = crypto.randomUUID();
    try {
      await withSessionRetry((token) => disablePaymentLink({
        accessToken: token,
        merchantId,
        environment,
        paymentLinkId: link.id,
        idempotencyKey: key,
      }));
      await reload();
    } catch {
      setError('Não foi possível desativar o link.');
    } finally {
      setMutating(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SwiftPay</span></div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <a href="/transactions">Transações</a>
          <a className="active" href="/payment-links">Links de pagamento</a>
          <a href="/settings/api-credentials">Credenciais API</a>
          <a href="/settings/webhooks">Webhooks</a>
        </nav>
        <button className="ghost-button" onClick={() => void signOut().then(() => { location.href = '/'; })}>Sair</button>
      </aside>

      <section className="content">
        <header className="page-header">
          <div><p className="eyebrow">Checkout hospedado</p><h1>Links de pagamento</h1></div>
          <div className="context-controls">
            <select aria-label="Merchant" value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>
              {contexts.map((item) => <option key={item.merchantId} value={item.merchantId}>{item.merchantName}</option>)}
            </select>
            <select aria-label="Ambiente" value={environment} onChange={(event) => setEnvironment(event.target.value as DashboardEnvironment)}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Produção</option>
            </select>
          </div>
        </header>

        {environment === 'production' ? (
          <section className="state-card"><h2>Produção indisponível</h2><p>A criação de links em Produção permanece bloqueada até a ativação segura do PSP real.</p></section>
        ) : null}
        {!canMutate && selectedContext ? (
          <section className="state-card"><p>Seu papel atual permite consultar links, mas criação e desativação exigem admin ou owner.</p></section>
        ) : null}
        {error ? <section className="state-card state-error" role="alert"><p>{error}</p></section> : null}

        <section className="settings-grid">
          <form className="settings-card" onSubmit={submit}>
            <p className="eyebrow">Novo link</p>
            <h2>Pix Sandbox de valor fixo</h2>
            <label>Valor em centavos<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1000" required /></label>
            <label>Descrição<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Pedido #123" /></label>
            <label>Expiração do Pix (minutos)<input inputMode="numeric" value={expiration} onChange={(event) => setExpiration(event.target.value)} required /></label>
            <button className="primary-button" type="submit" disabled={!canMutate || environment === 'production' || mutating}>{mutating ? 'Processando…' : 'Criar link'}</button>
          </form>

          <section className="settings-card">
            <p className="eyebrow">Links existentes</p>
            <h2>{loading ? 'Carregando…' : `${links.length} link(s)`}</h2>
            {!loading && links.length === 0 ? <p className="muted">Nenhum link neste ambiente.</p> : null}
            <div className="settings-list">
              {links.map((link) => (
                <article key={link.id} className="settings-row">
                  <div>
                    <strong>{money(link.amount)}</strong>
                    <p>{link.description || 'Sem descrição'} · {link.status === 'active' ? 'Ativo' : 'Desativado'}</p>
                    <small>Criado {date(link.createdAt)} · expira Pix em {link.pixExpirationMinutes} min</small>
                  </div>
                  <div className="row-actions">
                    <button className="ghost-button" type="button" onClick={() => void navigator.clipboard.writeText(`${location.origin}${link.checkoutPath}`)}>Copiar link</button>
                    <button className="ghost-button" type="button" disabled={!canMutate || link.status !== 'active' || mutating} onClick={() => void disable(link)}>Desativar</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

export function App() {
  if (location.pathname === '/payment-links') return <PaymentLinksView />;
  return (
    <>
      <a className="a23-payment-links-shortcut" href="/payment-links">Links de pagamento</a>
      <BaseApp />
    </>
  );
}
