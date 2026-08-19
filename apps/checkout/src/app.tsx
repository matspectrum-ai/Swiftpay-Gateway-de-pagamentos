import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckoutApiError, createCheckoutPayment, getPaymentLink, type CheckoutPayment, type PublicPaymentLink } from './api.js';

function tokenFromPath(): string | null {
  const match = /^\/pay\/([^/]+)$/.exec(location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function money(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function errorText(error: unknown): string {
  if (!(error instanceof CheckoutApiError)) return 'Não foi possível concluir a solicitação.';
  if (error.kind === 'rate_limited') return 'Muitas tentativas. Tente novamente em instantes.';
  if (error.kind === 'unavailable') return 'Checkout temporariamente indisponível.';
  if (error.kind === 'conflict') return 'Esta tentativa entrou em conflito. Inicie uma nova tentativa.';
  return 'Não foi possível concluir a solicitação.';
}

export function App() {
  const publicToken = useMemo(tokenFromPath, []);
  const [link, setLink] = useState<PublicPaymentLink | null>(null);
  const [payment, setPayment] = useState<CheckoutPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);

  useEffect(() => {
    if (!publicToken) { setNotFound(true); setLoading(false); return; }
    let active = true;
    void getPaymentLink(publicToken)
      .then((value) => { if (active) setLink(value); })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof CheckoutApiError && cause.kind === 'not_found') setNotFound(true);
        else setError(errorText(cause));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [publicToken]);

  async function generate() {
    if (!publicToken || generating) return;
    if (attemptKey.current === null) attemptKey.current = crypto.randomUUID();
    setGenerating(true);
    setError(null);
    try {
      const value = await createCheckoutPayment({ publicToken, idempotencyKey: attemptKey.current });
      setPayment(value);
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof CheckoutApiError && cause.kind === 'conflict') attemptKey.current = null;
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <main className="checkout-page"><section className="checkout-card"><p>Carregando checkout…</p></section></main>;
  if (notFound || !link) return <main className="checkout-page"><section className="checkout-card"><h1>Checkout não encontrado</h1><p>O link é inválido, foi desativado ou não está mais disponível.</p></section></main>;

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <header className="brand-row"><div className="brand-mark">S</div><strong>SwiftPay</strong><span className="sandbox-pill">Sandbox</span></header>
        <div className="sandbox-warning" role="status"><strong>Ambiente de teste</strong><span>Este Pix Sandbox é demonstrativo, não é pagável e não movimenta dinheiro real.</span></div>
        <p className="eyebrow">Pagamento para</p>
        <h1>{link.merchantName}</h1>
        <div className="amount">{money(link.amount)}</div>
        {link.description ? <p className="description">{link.description}</p> : null}
        <p className="muted">Pix de teste · expiração configurada em {link.pixExpirationMinutes} minutos</p>

        {!payment ? (
          <button className="primary" onClick={() => void generate()} disabled={generating}>{generating ? 'Gerando Pix…' : 'Gerar Pix de teste'}</button>
        ) : (
          <section className="pix-result" aria-live="polite">
            <p className="eyebrow">Pix gerado</p>
            <h2>{payment.status === 'creating' ? 'Criação em confirmação' : 'Aguardando pagamento de teste'}</h2>
            <p>{money(payment.amount)} · expira em {new Date(payment.expiresAt).toLocaleString('pt-BR')}</p>
            {payment.pix?.copyAndPaste ? (
              <>
                <code>{payment.pix.copyAndPaste}</code>
                <button className="secondary" onClick={() => void navigator.clipboard.writeText(payment.pix!.copyAndPaste)}>Copiar Pix de teste</button>
              </>
            ) : <p className="muted">A execução ficou em estado conservador. Repetir esta tentativa reutiliza a mesma chave idempotente.</p>}
          </section>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <footer>Checkout protegido pelo SwiftPay · Sandbox</footer>
      </section>
    </main>
  );
}
