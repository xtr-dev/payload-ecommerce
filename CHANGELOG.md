# Changelog

## [0.1.0] - 2026-11-27

### Breaking
- remove unimplemented options and exports, honour configured slugs everywhere ([#19](https://github.com/xtr-dev/payload-ecommerce/issues/19)) ([91a9a3a](https://github.com/xtr-dev/payload-ecommerce/commit/91a9a3a83a7abfe3f6bc62e005b1c3e49f813888))
- secure default access for all collections ([#18](https://github.com/xtr-dev/payload-ecommerce/issues/18)) ([9d456d8](https://github.com/xtr-dev/payload-ecommerce/commit/9d456d804258c359f1ddfe65ac7006b96b9353d6))
- fail the order when the calculateTax hook fails ([#15](https://github.com/xtr-dev/payload-ecommerce/issues/15)) ([751da52](https://github.com/xtr-dev/payload-ecommerce/commit/751da52c7a6c6db38e59e5429f0a39b30b98629b))
- identify cart lines by product and variant in updateCartItem ([#14](https://github.com/xtr-dev/payload-ecommerce/issues/14)) ([1c3b7de](https://github.com/xtr-dev/payload-ecommerce/commit/1c3b7defa9d59fb448c62d90b55e018c86f1348f))
- ignore expired carts, extend carts on activity and add expired-cart cleanup ([#10](https://github.com/xtr-dev/payload-ecommerce/issues/10)) ([2f1f13b](https://github.com/xtr-dev/payload-ecommerce/commit/2f1f13bb38812f8e9977e32bf73d8baa550cbc1f))
- check stock, make order side effects atomic and reverse them on cancel or refund ([#9](https://github.com/xtr-dev/payload-ecommerce/issues/9)) ([30a09fa](https://github.com/xtr-dev/payload-ecommerce/commit/30a09fae8bf6801f0b436067d460388547e8f040))
- apply coupons when an order is created, including free shipping ([#8](https://github.com/xtr-dev/payload-ecommerce/issues/8)) ([b691fb8](https://github.com/xtr-dev/payload-ecommerce/commit/b691fb87354ae9e4f24deba2c488f973e1864bb9))
- always compute the order total from its parts ([#6](https://github.com/xtr-dev/payload-ecommerce/issues/6)) ([363ffdc](https://github.com/xtr-dev/payload-ecommerce/commit/363ffdcbdf8f6abdb4c3e8421f670314a841f30d))

### Features
- develop on Payload 3.94 and Next 16, warn on the non-atomic fallback, allow a cart cleanup schedule ([#21](https://github.com/xtr-dev/payload-ecommerce/issues/21)) ([02e3801](https://github.com/xtr-dev/payload-ecommerce/commit/02e3801b049283c2ad505fdd9c32022a288661ac))
- round money, accept ids as text, relax addresses and add customerEmail for guest orders ([#20](https://github.com/xtr-dev/payload-ecommerce/issues/20)) ([4e2e7f9](https://github.com/xtr-dev/payload-ecommerce/commit/4e2e7f9249b1f8b568d065f6d6294429843ab9a0))
- generate unique product and category slugs from one shared helper ([#11](https://github.com/xtr-dev/payload-ecommerce/issues/11)) ([c684435](https://github.com/xtr-dev/payload-ecommerce/commit/c684435011041175fb2f6a2faff011eaea0c7162))

### Fixes
- restore an order's stock and coupon use once under simultaneous cancellations ([#16](https://github.com/xtr-dev/payload-ecommerce/issues/16)) ([00622aa](https://github.com/xtr-dev/payload-ecommerce/commit/00622aae22fd4973f52b9f33d85a8db4170cb909))
- price cart and order lines with the variant's own price ([#13](https://github.com/xtr-dev/payload-ecommerce/issues/13)) ([97cceac](https://github.com/xtr-dev/payload-ecommerce/commit/97cceac029c325337fa33dd5a1a4bc1f6ad43406))
- recalculate order tax only when a tax input changes ([#7](https://github.com/xtr-dev/payload-ecommerce/issues/7)) ([9bb7bd7](https://github.com/xtr-dev/payload-ecommerce/commit/9bb7bd7523d3d277deea8bfd7def80e93872c2e7))
- handle numeric document ids in order, cart and coupon logic ([#5](https://github.com/xtr-dev/payload-ecommerce/issues/5)) ([0834eaf](https://github.com/xtr-dev/payload-ecommerce/commit/0834eaf88cc29353edd582f9b513274f8a51d530))

### Other
- run the integration tests against MongoDB as well as SQLite ([#17](https://github.com/xtr-dev/payload-ecommerce/issues/17)) ([ec6a8b0](https://github.com/xtr-dev/payload-ecommerce/commit/ec6a8b06a09b7e056164aad1e97a46a039923f8d))
- describe what the plugin does and mark what is not implemented ([#12](https://github.com/xtr-dev/payload-ecommerce/issues/12)) ([90c5de7](https://github.com/xtr-dev/payload-ecommerce/commit/90c5de7024654fb37c57472a826e81dbf523c3cf))
- align workflows with the other plugin repos ([#4](https://github.com/xtr-dev/payload-ecommerce/issues/4)) ([ae79c82](https://github.com/xtr-dev/payload-ecommerce/commit/ae79c8218c20cf63568842f2bbfc9999aa2e6468))
- replace the pre-release warning with a v0.x note ([#3](https://github.com/xtr-dev/payload-ecommerce/issues/3)) ([50fae35](https://github.com/xtr-dev/payload-ecommerce/commit/50fae356a2c1533b745cbdcf2c465d7143b3de36))
