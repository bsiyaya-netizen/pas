# Trying the portal

The demo runs the whole system in your browser with sample data: 12 clients,
about 16 motor policies over the past months, one change, one cancellation,
a quote about to expire and a quote waiting for an underwriter. Sign-in is a
simple "who are you?" choice instead of Microsoft. Nothing you do is kept:
when the demo stops, the data resets.

## Opening it (no install)

1. On GitHub, open the repository and click the green **Code** button.
2. Choose the **Codespaces** tab, then **Create codespace on main**.
3. Wait a few minutes the first time while it sets up. The portal opens in a
   new browser tab by itself. If it doesn't, open the **Ports** tab at the
   bottom of the screen and click the globe next to **Broker portal**.
4. When you're done, close the tab and stop the codespace (Code button,
   Codespaces tab, the three dots, **Stop codespace**). Codespaces is free
   within GitHub's monthly allowance for personal accounts.

To reopen later, choose the same codespace from the Codespaces tab. If the
portal doesn't come up, type `npm run demo` in the terminal at the bottom.

## Journeys to try

Tick each one off and note anything that looks wrong, confusing or missing.

### As the broker

1. **Dashboard.** Sign in as **Broker**. Check the four tiles, the "Needs
   attention" list, the monthly chart and the insurer table make sense.
2. **New client.** Go to **Clients**, add a client. Try a wrong ID number
   (e.g. change the last digit of a real one) and check it is refused.
3. **Quote.** Go to **New quote**, pick your client and enter a car. Compare
   the insurers' prices. Open the breakdown and check the premium and
   commission look right.
4. **Referral.** Make another quote for a driver with **3 claims** in the last
   3 years. That option says it needs referral; click **Refer to …**.
5. **Bind.** On a quote with a bindable option, click **Bind** and confirm.
   You land on the new policy.
6. **Documents.** On the policy, download the **Policy schedule (PDF)** and the
   **Certificate of insurance (PDF)**. Check names, vehicle, premium,
   commission and the disclosures.
7. **Change cover.** Click **Change cover**, raise the excess or change the car
   value, click **Price the change**, check the new premium and the extra or
   refund, then **Confirm change**. The **History** shows the change.
8. **Cancel.** On another policy click **Cancel policy**, pick a reason and
   date, **Work out the refund**, then cancel. The status shows cancelled and
   the certificate can no longer be downloaded once the date has passed.
9. **Reports.** Back on **Dashboard**, download the **Policy register** and the
   **Transactions** report and open them in Excel.

### As the underwriter

10. **Sign out**, then sign in as **Underwriter**. Under **Referrals** you see
    the referred quote(s), including the one you made in step 4. Open the
    risk details and **Approve** one with a note.
11. Sign back in as **Broker**. The approved quote can now be bound.

## Things that aren't built yet

Renewals, home and commercial property screens, billing and claims.
