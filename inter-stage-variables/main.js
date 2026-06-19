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
		format
	});

	const module = device.createShaderModule({
		label: "our hardcoded RGB triangle shaders",
		code: /* wgsl */`
			struct OurVertexShaderOutput {
				@builtin(position) position: vec4f,
				@location(0) color: vec4f,
			};

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> OurVertexShaderOutput {
				let pos = array(
				  vec2f(0.0, 0.5),
				  vec2f(-0.5, -0.5),
				  vec2f(0.5, -0.5),
				);
				let color = array<vec4f, 3>(
					vec4f(1, 0, 0, 1),
					vec4f(0, 1, 0, 1),
					vec4f(0, 0, 1, 1),
				);

				var vsOutput: OurVertexShaderOutput;
				vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
				vsOutput.color = color[vertexIndex];
				return vsOutput;
			}

			@fragment fn fs(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
				return fsInput.color;
			}
		`
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
		}
	});

	const renderPassDesc = {
		label: "demo render pass descriptor",
		colorAttachments: [
			{
				//view: TODO
				clearValue: [0.3, 0.3, 0.3, 1.0],
				loadOp: "clear",
				storeOp: "store",
			}
		]
	};

	function render() {
		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);
		pass.draw(3);
		pass.end();

		const commandBuffer = encoder.finish();
		device.queue.submit([commandBuffer]);
	}

	const observer = new ResizeObserver(entries => {
		for (const entry of entries) {
			const canvas = entry.target;
			const width = entry.contentBoxSize[0].inlineSize;
			const height = entry.contentBoxSize[0].blockSize;
			canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
			canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
		}
		render();
	});

	observer.observe(canvas);
}
main()
