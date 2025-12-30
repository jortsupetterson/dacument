# Runtime only TextRGA solving the garbage collection issue by solving conflicts pre-inialization via LIWregister. This must be used with LIW register

_For Offline-Capable Distributed User Interfaces_

## Abstract

The idea is that the RGA state is stored as nothing but a string that resolves against competitors via LIW and then a TemporaryTextRGA gets created by splitting the string in to ops with no tomb stones, but then tombstone cabable and confcict free upon runtime/realtime, it is meant for realtime usage only, and it is meant to be used specifically in a way where there are no local writes means the writer hosting this thing must be a peer them selves. this goes extremely well with

---
