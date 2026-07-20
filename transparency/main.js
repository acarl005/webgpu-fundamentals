async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    console.error("WebGPU not supported");
    return;
  }

  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        clearValue: [1, 0, 0, 0.01],
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  let settings = {
    premultiply: false,
    color: [255, 0, 0],
    alpha: 0.01,
  };

  function render() {
    renderPassDesc.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

    const { alpha, color } = settings;
    let { clearValue } = renderPassDesc.colorAttachments[0];
    clearValue[3] = alpha;
    if (settings.premultiply) {
      clearValue[0] = (color[0] / 255) * alpha;
      clearValue[1] = (color[1] / 255) * alpha;
      clearValue[2] = (color[2] / 255) * alpha;
    } else {
      clearValue[0] = color[0] / 255;
      clearValue[1] = color[1] / 255;
      clearValue[2] = color[2] / 255;
    }

    const encoder = device.createCommandEncoder({ label: "our demo encoder" });
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.end();

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(
        1,
        Math.min(width, device.limits.maxTextureDimension2D),
      );
      canvas.height = Math.max(
        1,
        Math.min(height, device.limits.maxTextureDimension2D),
      );
    }
    render();
  });

  observer.observe(canvas);

  let gui = new dat.GUI({});
  gui.add(settings, "premultiply").onChange(render);
  gui.add(settings, "alpha", 0, 1).onChange(render);
  gui.addColor(settings, "color").onChange(render);
}
main();
