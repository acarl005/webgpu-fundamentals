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
			struct MyImmediates {
  			color: vec4f,
  			offset: vec2f,
			};

			var<immediate> myImmediates: MyImmediates;

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> @builtin(position) vec4f {
				let pos = array(
				  vec2f(0.0, 0.5),
				  vec2f(-0.5, -0.5),
				  vec2f(0.5, -0.5),
				);

				return vec4f(pos[vertexIndex] + myImmediates.offset, 0.0, 1.0);
			}

			@fragment fn fs() -> @location(0) vec4f {
				return myImmediates.color;
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
  });

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

  function render() {
    renderPassDesc.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView();

    const encoder = device.createCommandEncoder({ label: "our demo encoder" });
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(pipeline);
    // prettier-ignore
    pass.setImmediates(0, new Float32Array([
    	1, 0, 0, 1, // color
    	-0.4, -0.2  // offset
    ]));
    pass.draw(3);
    // prettier-ignore
    pass.setImmediates(0, new Float32Array([
    	0, 1, 0, 1, // color
    	0.4, -0.2  // offset
    ]));
    pass.draw(3);
    // prettier-ignore
    pass.setImmediates(0, new Float32Array([
    	0, 0, 1, 1, // color
    	0.0, 0.2  // offset
    ]));
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
