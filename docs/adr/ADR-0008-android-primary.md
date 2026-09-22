# ADR-0008 — Android is the primary platform

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** Emma
- **Related:** ADR-0007 (where the recorder lives),
  `../../../docs/platform-question.md`, `../../../docs/ios-platform-limitations.md`

## Context

`platform-question.md` and ADR-0007 between them establish that iOS refuses an
installed web app the capabilities this app needs, that every workaround is
closed off (no background capture, no background execution to catch up with, no
`localhost` transport to a native helper, and no interruption recovery even in a
native shell), and that the routes which remain all cost the family's
install-from-a-URL distribution.

Up to now both platforms have been treated as equally binding, which meant every
design question was answered by its hardest case. That is how the six-second
commit floor, the two-tier recorder and the live-queue design all came to be
discussed: each was an attempt to work around iOS, and each collapsed on contact
with it.

Emma rings on a Samsung, every recording this project has analysed came from it,
and Android supports what the app needs.

## Decision

**Android is the primary platform. iOS is best-effort.**

- Design decisions are settled on what works on Android. Where iOS would force a
  different design, the Android design wins and iOS gets whatever falls out.
- A feature that works only on Android ships. It is not held back, and it is not
  redesigned around an iOS constraint.
- iOS support is welcome where it is cheap. It is not a release gate and it does
  not get a workaround budget.
- The limitations are written up in `docs/ios-platform-limitations.md` and going
  to Apple. Filing them is the response to the problem; engineering around them
  is not.

## Options considered

**Both platforms equally.** What we were implicitly doing. Rejected: it lets the
most restrictive platform set the architecture for the other, and the last two
days show what that produces — three designs proposed and abandoned, none of them
because of anything about ringing.

**iOS-first.** Rejected on the evidence: it is the platform that cannot do the
job, and there is no user pulling us there.

**Android only, iOS explicitly unsupported.** Cleaner to state and cheaper to
test. Rejected as premature — the record-and-report mode with the screen awake
works on iOS today, and the file-import path works on both. Declaring iOS
unsupported would throw that away for tidiness.

## Consequences

**Easier.** One platform's answer settles a design question. Tuesday's test is an
Android test. The PWA route stays viable, because the thing that killed it was
always iOS. The in-touch feedback question becomes answerable on its own merits
rather than through the platform.

**Harder.** Two behaviours to explain to users, and the honest version of "works
on iPhone" is "works while you are looking at it". The app must say which mode it
is in rather than letting an iPhone user discover the difference by losing a
practice.

**To revisit.** If Apple moves on item 1 of the limitations document, most of
this record lapses. Nothing here is a judgement about iOS as a platform for
anything else — it is about one capability this app needs and cannot have.
