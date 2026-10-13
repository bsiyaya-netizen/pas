import type { User } from "oidc-client-ts";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { currentUser, roleOf, userManager } from "./auth";
import { Clients } from "./pages/Clients";
import { NewQuote } from "./pages/NewQuote";
import { PolicyView } from "./pages/PolicyView";
import { QuoteList } from "./pages/QuoteList";
import { QuoteView } from "./pages/QuoteView";
import { Referrals } from "./pages/Referrals";
import { href, useRoute } from "./router";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string>();

  useEffect(() => {
    currentUser().then(setUser, (e: Error) => {
      setError(e.message);
      setUser(null);
    });
  }, []);

  if (user === undefined) return <p className="page">Loading…</p>;
  if (!user) {
    return (
      <main className="signin">
        <h1>Broker Portal</h1>
        {error && <p className="error">{error}</p>}
        <button onClick={() => userManager.signinRedirect()}>Sign in</button>
      </main>
    );
  }
  return <SignedIn user={user} />;
}

function SignedIn({ user }: { user: User }) {
  const role = roleOf(user);
  const client = useMemo(() => api(user.access_token), [user.access_token]);
  const route = useRoute();
  const name = user.profile.name ?? user.profile.email ?? "Signed in";

  let page;
  if (role === "broker") {
    const [section, id] = route;
    if (section === "quotes" && id === "new") page = <NewQuote api={client} />;
    else if (section === "quotes" && id) page = <QuoteView api={client} quoteId={id} />;
    else if (section === "clients") page = <Clients api={client} editing={id} />;
    else if (section === "policies" && id) page = <PolicyView api={client} policyNumber={id} />;
    else page = <QuoteList api={client} />;
  } else if (role === "underwriter") {
    page = <Referrals api={client} />;
  } else {
    page = <p className="page">Your account has no broker or underwriter role. Ask your administrator to set one.</p>;
  }

  return (
    <>
      <header className="bar">
        <strong>Broker Portal</strong>
        <nav>
          {role === "broker" && (
            <>
              <a href={href("quotes")}>Quotes</a>
              <a href={href("quotes", "new")}>New quote</a>
              <a href={href("clients")}>Clients</a>
            </>
          )}
          {role === "underwriter" && <a href={href("referrals")}>Referrals</a>}
        </nav>
        <span className="who">
          {name}
          <button className="link" onClick={() => userManager.signoutRedirect()}>
            Sign out
          </button>
        </span>
      </header>
      <main className="page">{page}</main>
    </>
  );
}
