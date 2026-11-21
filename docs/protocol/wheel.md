# Lucky wheels

The `wheelSpin` plugin spins the two lucky wheels with tickets the player holds. One spin was captured on 2026-11-21 (client 1173012, fixture `packages/bot-core/test/fixtures/protocol/daily-20261121.json`, entry `lws_1`). The rest comes from reading the client bundle as text, and the table says which is which.

## The two wheels

| | Wheel of Unimaginable Affluence | Wheel of Fortune (classic) |
|---|---|---|
| Event id (`EID`) | 89, `EVENTTYPE_LUCKYWHEEL_SD` | 15, `EVENTTYPE_LUCKYWHEEL` |
| `LWET` in `lws` | 1 | 0 (the client sends `new C2SLuckyWheelSpinVO(0)`) |
| Ticket currency | `SLWT`, currency 45, `resources.saleDaysLuckyWheelTicket` | `LWT`, currency 20, `resources.luckyWheelTicket` |
| Tickets per normal spin | 1 | 30, or 0 on a free spin |
| Pro mode spin | not offered | 300 |
| Seen on the wire | yes | no, from client code only |

## Spin

`lws {"LWET":1}` is `C2SLuckyWheelSpinVO`. The reply for the captured spin, result 0:

```json
{"LWET":1,"R":[["SLWT",1]],"WC":2,"CWC":1,"WCP":1,"HFS":0,"HVPM":0,"JSID":9,"JHID":9,"PMA":0,"OP":[0],"OR":[-1]}
```

| Field | Meaning | Certainty |
|---|---|---|
| `R` | The prize, a list of `[currency, amount]`. Here one affluence ticket came back. | Shape seen once. Other prize shapes are unknown. |
| `WC` | The winning category | Read by the client (`parseLWS`), meaning inferred |
| `CWC`, `WCP` | Current prize level and progress inside it | Read by the client |
| `HFS` | Has a free spin | Read by the client |
| `HVPM`, `PMA` | Has visited Pro mode, Pro mode is on | Read by the client |
| `JSID`, `JHID` | Jackpot set ids for a normal and a jackpot spin | Read by the client |
| `OP`, `OR` | Contest points and rank, as `pep` returns them | `[0]` and `[-1]` while unranked |

Order on the wire: the client's `lws`, then `sce [["SLWT",11]]` (the ticket is taken), then `sce [["SLWT",12]]` (the prize), then the `lws` reply, 0.37 s after the request. The tickets in `resources` are already final when the reply arrives.

`pep {"EID":89}` returned `{"OP":[0],"OR":[-1],"EID":89}`. Spins count toward an "affluence spin contest" with rank rewards. The plugin never reads or targets it.

## Event list

The event's own `sei` entry carries the wheel's state, so no extra call is needed:

```json
{"EID":89,"RS":1052,"OP":[0],"OR":[-1],"LID":1,"PET":30,"CWC":1,"WCP":0,"HFS":0,"HVPM":0,"JSID":2,"JHID":2,"PMA":0}
```

`RS` is the seconds left when the list was sent. A wheel is running when its id is in the latest `sei` (or `fjf.sei`). The plugin turns `RS` into an end time when the list arrives, spins only while more than a minute is left (the client greys out its button under 10 seconds), and treats `PMA` 1 as a reason not to spin. Tickets do not expire between events, but the prize level starts again from the lowest.

## What the plugin never sends

- `lwj` (`C2SLuckyWheelBuyJackpotVO`), the jackpot. It can cost rubies.
- `lwm`, the switch between normal and Pro mode. Pro mode costs 10 times the tickets.
- A free spin. It spins only when the tickets cover the cost and the tickets to keep.

## Unknown

- The classic wheel's `lws` and its reply were never captured. `LWET` 0, 30 tickets a spin and the event id 15 come from client code and game data (`items` event 15 and the currency table).
- Whether the classic wheel's `sei` entry carries `PMA` and `HFS` as the affluence one does.
- The prize shapes other than a returned ticket.
- How a free spin (`HFS` 1) is requested, and whether it needs `LWET` 0.
- Whether the daily day is UTC. The plugin counts its daily limit by UTC day and loses the count when the bot restarts.
- The affluence event ran 17 minutes in the `sei` sample above and the trace notes put it near 11 hours at the spin. The plugin trusts the `RS` of the latest list.
