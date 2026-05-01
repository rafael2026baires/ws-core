DECISIÓN:
tech_state NO se persiste en Redis (2026)

MOTIVO:
- cálculo barato
- un solo backend lógico
- evitar duplicación

REVISAR SI:
- hay múltiples consumidores
- se agregan alertas/eventos
- escala horizontal compleja