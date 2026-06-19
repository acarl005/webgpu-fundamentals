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
		label: "our hardcoded green triangle shaders",
		code: /* wgsl */`
			struct OurStruct {
				color: vec4f,
				scale: vec2f,
				offset: vec2f,
			}

			@group(0) @binding(0) var<uniform> ourStruct: OurStruct;

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> @builtin(position) vec4f {
				let pos = array(
				  vec2f(0.0, 0.5),
				  vec2f(-0.5, -0.5),
				  vec2f(0.5, -0.5),
				);

				return vec4f(pos[vertexIndex] * ourStruct.scale + ourStruct.offset, 0.0, 1.0);
			}

			@fragment fn fs() -> @location(0) vec4f {
				return ourStruct.color;
			}
		`
	});

	const uniformBufferSize =
		4 * 4 + // color: vec4f,
		2 * 4 + // scale: vec2f,
		2 * 4;  // offset: vec2f,

	const uniformBuffer = device.createBuffer({
		size: uniformBufferSize,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
	});

	const uniformValues = new Float32Array(uniformBufferSize / 4);

	const kColorOffset = 0;
	const kScaleOffset = 4;
	const kOffsetOffset = 6;

	uniformValues.set([0, 1, 0, 1], kColorOffset);
	uniformValues.set([-0.5, -0.25], kOffsetOffset);

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

	const bindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: uniformBuffer }
		]
	});

	function render() {
		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const aspect = canvas.width / canvas.height;
		uniformValues.set([0.5 / aspect, 0.5], kScaleOffset);

		device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
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
