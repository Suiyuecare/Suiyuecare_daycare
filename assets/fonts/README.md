# Pinned Traditional Chinese PDF font

Noto Sans TC, statically instantiated at weight 400 from the pinned upstream
variable TrueType font, SIL Open Font License 1.1. This is a modified version;
the reserved font name `Source` is not used for the derived font.

- Upstream repository: https://github.com/google/fonts
- Pinned revision: `3be1884c48c3e45b52ecc725676a08f87776373e`
- Font source: `ofl/notosanstc/NotoSansTC[wght].ttf`.
- Upstream SHA-256: `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`.
- Transformation: fontTools 4.60.1, `python -m fontTools.varLib.instancer NotoSansTC-Variable.ttf wght=400 --output NotoSansTC-Regular.ttf`.
- Bundled derived asset SHA-256: `b4ebe30cc77de66e271483b41f5d7ee60baa070054a0b938f87c88491b5d1b91`.
- License source: `ofl/notosanstc/OFL.txt`, preserved as `NotoSansTC-OFL.txt` alongside the font (one trailing space normalized; license text unchanged).

This is a software rendering asset, not an approved official form or a clinical
rule. It contains no client data. Only the server PDF export route traces it;
it is not served from `public/`. Application code verifies the pinned SHA-256
before embedding glyphs. Font and license changes require source review and a
new hash, not a client-supplied download location.
