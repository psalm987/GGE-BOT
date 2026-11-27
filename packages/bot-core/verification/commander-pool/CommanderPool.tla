---------------------------- MODULE CommanderPool ----------------------------
(***************************************************************************)
(* The commander pool in plugins/commander.js, as the attack plugins use   *)
(* it. Every attack plugin borrows a commander (Lord) with                 *)
(* waitForCommanderAvailable, queues one attack with waitToAttack          *)
(* (plugins/attack/attack.js), and gives the commander back with           *)
(* freeCommander, either right away (no target, error) or when its march   *)
(* returns.                                                                *)
(*                                                                         *)
(* One step of this spec is one synchronous run of JavaScript: nothing     *)
(* else can run in the middle of it. A step ends where the code awaits.    *)
(* Steps marked "macrotask" start from a timer or a websocket message,     *)
(* so they run only when no microtask is pending.                          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Lords,        \* commanders loaded from "gli" (commander.js:13-14)
    Plugins,      \* attack loops running at once, one per enabled plugin
    LoopPlugins,  \* loops shaped like attackKhan: free, then `continue` to
                  \* the top of `while (!quit)` in the same synchronous run
                  \* (attackKhan, attackNomads, attackSamurai,
                  \* attackBerimondInvasion). The rest are shaped like
                  \* sendHit: free, `return`, and re-enter at least one
                  \* microtask later (sharedBarronAttackLogic,
                  \* sharedFortressAttackLogic, attackStormForts).
    NoLord,       \* a loop holds no commander
    Mutation      \* "none" models the code as it is. The other values model
                  \* a deliberately broken variant, to show a rule can fail.

ASSUME LoopPlugins \subseteq Plugins
ASSUME NoLord \notin Lords
ASSUME Mutation \in {"none", "wakeSkipsUse", "freeSkipsWake",
                     "returnSkipsFree", "okFreesLord"}

VARIABLES
    pool,          \* [used, waiters, pc, lord]: everything commander.js and
                   \* the loops' own variables hold
    away,          \* commanders the game server has out on a march
    outcome,       \* how each loop's current attack ended
    queueSleeping  \* attack.js:281-282: the queue waits on the limiter and
                   \* sleep after a successful attack

vars == <<pool, away, outcome, queueSleeping>>

(* pool.used    = usedCommanders (commander.js:9)                          *)
(* pool.waiters = "freedCommander" listeners, in the order they were added *)
(*                (commander.js:81-94)                                     *)
(* pool.lord[p] = the commander loop p holds, or was woken with            *)
(* pool.pc[p]   = where loop p is:                                         *)
(*   "parked"   not in the pool; it starts again from a macrotask          *)
(*              (startup, the next map scan, or waiting for troops)        *)
(*   "acquire"  a sendHit loop returned true; `while (await sendHit())`    *)
(*              calls waitForCommanderAvailable on a later microtask       *)
(*   "waiting"  registered a freedCommander listener (commander.js:93)     *)
(*   "woken"    the listener resolved with a commander, but the await      *)
(*              continuation that calls useCommander (commander.js:96)     *)
(*              has not run                                                *)
(*   "queued"   holds a commander; its attack callback is in waitToAttack  *)
(*   "sent"     its callback sent "cra" and awaits the reply               *)
(*   "settled"  waitToAttack settled; the code after it has not run        *)

PC == {"parked", "acquire", "waiting", "woken", "queued", "sent", "settled"}
Outcomes == {"none", "ok", "noTarget", "noTroops", "retry", "lordIsUsed"}

Pending == {p \in Plugins : pool.pc[p] \in {"acquire", "woken", "settled"}}
NoPendingJobs == Pending = {}
NoneWoken == \A p \in Plugins : pool.pc[p] # "woken"

TypeOK ==
    /\ pool.used \subseteq Lords
    /\ pool.pc \in [Plugins -> PC]
    /\ pool.lord \in [Plugins -> Lords \cup {NoLord}]
    /\ \A i \in 1..Len(pool.waiters) : pool.waiters[i] \in Plugins
    /\ away \subseteq Lords
    /\ outcome \in [Plugins -> Outcomes]
    /\ queueSleeping \in BOOLEAN

-----------------------------------------------------------------------------
(* Pool operations on a pool record s, so a step can chain them.           *)

(* freeCommander(l), commander.js:16-22. It does nothing unless l is in    *)
(* use. Otherwise it removes l and dispatches "freedCommander"; with no    *)
(* whitelist set, the first listener takes it, marks it used again in the  *)
(* same run (commander.js:93), and stops propagation. "wakeSkipsUse" is    *)
(* the code before that mark, where only Resume marked it.                 *)
FreeState(s, l) ==
    IF l \notin s.used THEN s
    ELSE IF s.waiters = <<>> \/ Mutation = "freeSkipsWake"
         THEN [s EXCEPT !.used = @ \ {l}]
         ELSE LET q == Head(s.waiters) IN
              [s EXCEPT !.used    = IF Mutation = "wakeSkipsUse" THEN @ \ {l} ELSE @,
                        !.waiters = Tail(@),
                        !.pc      = [@ EXCEPT ![q] = "woken"],
                        !.lord    = [@ EXCEPT ![q] = l]]

(* waitForCommanderAvailable for loop p, commander.js:56-98, up to its     *)
(* first await. The first usable commander is picked and marked in the     *)
(* same run (commander.js:70-79, 96); with none usable, p adds a listener. *)
(* Which usable commander comes first depends on commanders order and the  *)
(* sort callback, so the spec allows any.                                  *)
Acquired(s, p, s2) ==
    LET usable == Lords \ s.used IN
    IF usable = {}
    THEN s2 = [s EXCEPT !.waiters = Append(@, p),
                        !.pc      = [@ EXCEPT ![p] = "waiting"],
                        !.lord    = [@ EXCEPT ![p] = NoLord]]
    ELSE \E l \in usable :
         s2 = [s EXCEPT !.used = @ \cup {l},
                        !.pc   = [@ EXCEPT ![p] = "queued"],
                        !.lord = [@ EXCEPT ![p] = l]]

-----------------------------------------------------------------------------
(* Steps                                                                   *)

(* Macrotask: a parked loop starts and calls waitForCommanderAvailable.    *)
Start(p) ==
    /\ NoPendingJobs
    /\ pool.pc[p] = "parked"
    /\ Acquired(pool, p, pool')
    /\ UNCHANGED <<away, outcome, queueSleeping>>

(* Microtask: a sendHit loop re-enters after `return true`.               *)
Reacquire(p) ==
    /\ NoneWoken
    /\ pool.pc[p] = "acquire"
    /\ Acquired(pool, p, pool')
    /\ UNCHANGED <<away, outcome, queueSleeping>>

(* Microtask: the woken listener's await continues and calls              *)
(* useCommander(lordID) again (commander.js:99), a no-op unless the        *)
(* hand-off skipped it. This spec runs it before any other queued job;     *)
(* see "Scope" in the skill.                                               *)
Resume(p) ==
    /\ pool.pc[p] = "woken"
    /\ pool' = [pool EXCEPT
                  !.used = @ \cup {pool.lord[p]},
                  !.pc   = [@ EXCEPT ![p] = "queued"]]
    /\ UNCHANGED <<away, outcome, queueSleeping>>

(* The waitToAttack loop (attack.js:268-287) runs p's callback. It runs    *)
(* one callback at a time. After a success it sleeps first; after an       *)
(* error or no target it runs the next one at once, inside the same        *)
(* macrotask. The callback finds no target, runs out of troops, or sends   *)
(* "cra".                                                                  *)
Run(p) ==
    /\ NoneWoken
    /\ pool.pc[p] = "queued"
    /\ ~queueSleeping
    /\ \A q \in Plugins : pool.pc[q] # "sent"
    /\ \/ /\ pool' = [pool EXCEPT !.pc = [@ EXCEPT ![p] = "settled"]]
          /\ outcome' = [outcome EXCEPT ![p] = "noTarget"]
       \/ /\ pool' = [pool EXCEPT !.pc = [@ EXCEPT ![p] = "settled"]]
          /\ outcome' = [outcome EXCEPT ![p] = "noTroops"]
       \/ /\ pool' = [pool EXCEPT !.pc = [@ EXCEPT ![p] = "sent"]]
          /\ UNCHANGED outcome
    /\ UNCHANGED <<away, queueSleeping>>

(* Macrotask: the server answers "cra". A commander already out on a       *)
(* march gets LORD_IS_USED. Otherwise the attack leaves, and the           *)
(* "outgoing" movement event marks the commander used again                *)
(* (protocols.js:1197, commander.js:31-38), or it fails with an error the  *)
(* loops retry on (COOLING_DOWN, MISSING_UNITS, ...). The queue sleeps    *)
(* after a rejection too (attack.js waitToAttack).                         *)
Respond(p) ==
    /\ NoPendingJobs
    /\ pool.pc[p] = "sent"
    /\ LET l == pool.lord[p] IN
       IF l \in away
       THEN /\ outcome' = [outcome EXCEPT ![p] = "lordIsUsed"]
            /\ pool' = [pool EXCEPT !.pc = [@ EXCEPT ![p] = "settled"]]
            /\ UNCHANGED <<away, queueSleeping>>
       ELSE \/ /\ outcome' = [outcome EXCEPT ![p] = "ok"]
               /\ away' = away \cup {l}
               /\ pool' = [pool EXCEPT !.used = @ \cup {l},
                                       !.pc   = [@ EXCEPT ![p] = "settled"]]
               /\ queueSleeping' = TRUE
            \/ /\ outcome' = [outcome EXCEPT ![p] = "retry"]
               /\ pool' = [pool EXCEPT !.pc = [@ EXCEPT ![p] = "settled"]]
               /\ queueSleeping' = TRUE
               /\ UNCHANGED away

(* Microtask: the loop handles the result.                                 *)
(*   ok         keeps the commander until its march returns                *)
(*   noTarget   freeCommander                                              *)
(*   noTroops   freeCommander, then wait for a march to return (parked)    *)
(*   retry      freeCommander                                              *)
(*   lordIsUsed commanderRefused: kept used, no waiter woken               *)
(* Then a loop plugin re-enters waitForCommanderAvailable in this same run *)
(* (e.g. attackKhan.js:428-450). A sendHit loop returns: false for no      *)
(* target (parked), true otherwise ("acquire", a later microtask)          *)
(* (e.g. sharedFortressAttackLogic.js:126-152).                            *)
React(p) ==
    /\ NoneWoken
    /\ pool.pc[p] = "settled"
    /\ LET l       == pool.lord[p]
           o       == outcome[p]
           freed   == IF (o = "ok" /\ Mutation # "okFreesLord") \/ o = "lordIsUsed"
                      THEN pool ELSE FreeState(pool, l)
           marked  == IF o = "lordIsUsed"
                      THEN [freed EXCEPT !.used = @ \cup {l}] ELSE freed
           cleared == [marked EXCEPT !.lord = [@ EXCEPT ![p] = NoLord]]
       IN  IF o = "noTroops"
           THEN pool' = [cleared EXCEPT !.pc = [@ EXCEPT ![p] = "parked"]]
           ELSE IF p \in LoopPlugins
           THEN Acquired(cleared, p, pool')
           ELSE IF o = "noTarget"
           THEN pool' = [cleared EXCEPT !.pc = [@ EXCEPT ![p] = "parked"]]
           ELSE pool' = [cleared EXCEPT !.pc = [@ EXCEPT ![p] = "acquire"]]
    /\ outcome' = [outcome EXCEPT ![p] = "none"]
    /\ UNCHANGED <<away, queueSleeping>>

(* Macrotask: a commander's return movement arrives (protocols.js:1201-    *)
(* 1215) and commander.js:40-47 frees it.                                  *)
MarchReturns(l) ==
    /\ NoPendingJobs
    /\ l \in away
    /\ away' = away \ {l}
    /\ pool' = IF Mutation = "returnSkipsFree" THEN pool ELSE FreeState(pool, l)
    /\ UNCHANGED <<outcome, queueSleeping>>

(* Macrotask: the queue's limiter and sleep finish (attack.js:281-282).    *)
QueueWakes ==
    /\ NoPendingJobs
    /\ queueSleeping
    /\ queueSleeping' = FALSE
    /\ UNCHANGED <<pool, away, outcome>>

Init ==
    /\ pool = [used    |-> {},
               waiters |-> <<>>,
               pc      |-> [p \in Plugins |-> "parked"],
               lord    |-> [p \in Plugins |-> NoLord]]
    /\ away = {}
    /\ outcome = [p \in Plugins |-> "none"]
    /\ queueSleeping = FALSE

Next ==
    \/ \E p \in Plugins : Start(p)
    \/ \E p \in Plugins : Reacquire(p)
    \/ \E p \in Plugins : Resume(p)
    \/ \E p \in Plugins : Run(p)
    \/ \E p \in Plugins : Respond(p)
    \/ \E p \in Plugins : React(p)
    \/ \E l \in Lords : MarchReturns(l)
    \/ QueueWakes

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Rules                                                                   *)

Holds(p) == pool.pc[p] \in {"woken", "queued", "sent", "settled"}
Promised == {pool.lord[p] : p \in {q \in Plugins : pool.pc[q] = "woken"}}

(* Two attack loops never hold the same commander at once.                 *)
NoDoubleBooking ==
    \A p, q \in Plugins :
        (p # q /\ Holds(p) /\ Holds(q)) => pool.lord[p] # pool.lord[q]

(* The bot never sends an attack with a commander that is out on a march,  *)
(* so its own bookkeeping never causes LORD_IS_USED.                       *)
NoBusyLordSent == \A p \in Plugins : outcome[p] # "lordIsUsed"

(* No loop waits while a commander sits free and unpromised.               *)
NoStrandedWaiter ==
    (\E p \in Plugins : pool.pc[p] = "waiting")
        => Lords \subseteq (pool.used \cup Promised)

(* Every commander marked in use is out on a march or held by a loop, so   *)
(* something will free it.                                                 *)
NoLeakedLord ==
    \A l \in pool.used :
        l \in away \/ \E p \in Plugins : Holds(p) /\ pool.lord[p] = l

=============================================================================
