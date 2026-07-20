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
  });

  const module = device.createShaderModule({
    label: "our hardcoded green triangle shaders",
    code: /* wgsl */ `
		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> @builtin(position) vec4f {
				let pos = array(
				  vec2f(0.0, 0.5),
				  vec2f(-0.5, -0.5),
				  vec2f(0.5, -0.5),
				);

				return vec4f(pos[vertexIndex], 0.0, 1.0);
			}

			@fragment fn fs() -> @location(0) vec4f {
				return vec4f(0.0, 1.0, 0.0, 1.0);
			}
		`,
  });

  const pipeline = device.createRenderPipeline({
    label: "demo render pipeline",
    layout: "auto",
    vertex: {
      entryPoint: "vs",
      module,
    },
    fragment: {
      entryPoint: "fs",
      module,
      targets: [{ format }],
    },
    multisample: {
      count: 4,
    },
  });

  /** @type{GPURenderPassDescriptor} */
  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        clearValue: [0.3, 0.3, 0.3, 1.0],
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  /** @type{GPUTexture} */
  let multisampleTexture;

  function render() {
    const canvasTexture = context.getCurrentTexture();

    if (
      !multisampleTexture ||
      multisampleTexture.width !== canvasTexture.width ||
      multisampleTexture.height !== canvasTexture.height
    ) {
      if (multisampleTexture) {
        multisampleTexture.destroy();
      }
      multisampleTexture = device.createTexture({
        format: canvasTexture.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        size: [canvasTexture.width, canvasTexture.height],
        sampleCount: 4,
      });
    }

    renderPassDesc.colorAttachments[0].view = multisampleTexture.createView();
    renderPassDesc.colorAttachments[0].resolveTarget =
      canvasTexture.createView();

    const encoder = device.createCommandEncoder({ label: "our demo encoder" });
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(pipeline);
    pass.draw(3);
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
}
main();
