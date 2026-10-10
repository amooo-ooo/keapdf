<script lang="ts">
  import type { BarcodeElement } from '../../stores/canvas-types';
  import type { ElementRenderProps } from '../../core/element-registry';
  import { generateQrCodeSvg, generateBarcodeSvg } from '../../utils/barcode-generator';

  let {
    element,
  }: ElementRenderProps<BarcodeElement> = $props();

  const svgMarkup = $derived.by(() => {
    if (element.svgContent) {
      return element.svgContent;
    }
    const payload = element.payload || 'https://keapdf.com';
    const symbology = element.symbology || 'qr-code';
    if (symbology === 'code-128') {
      return generateBarcodeSvg(payload, {
        fgColor: element.fgColor || '#000000',
        bgColor: element.bgColor || '#ffffff',
        includeText: element.includeText !== false,
        width: element.width,
        height: element.height,
      });
    } else {
      return generateQrCodeSvg(payload, {
        fgColor: element.fgColor || '#000000',
        bgColor: element.bgColor || '#ffffff',
        width: element.width,
        height: element.height,
      });
    }
  });
</script>

<div
  role="img"
  aria-label={`Barcode: ${element.payload || 'https://keapdf.com'}`}
  class="w-full h-full relative overflow-hidden flex items-center justify-center select-none bg-white rounded-xs"
>
  {@html svgMarkup}
</div>
