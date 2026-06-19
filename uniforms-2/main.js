function rand(min, max) {
	if (min === undefined) {
		min = 0;
		max = 1;
	} else if (max === undefined) {
		max = min;
		min = 0;
	}
	return min + Math.random() * (max - min);
}

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
				offset: vec2f,
			}

			struct OtherStruct {
				scale: vec2f,
			}

			@group(0) @binding(0) var<uniform> ourStruct: OurStruct;
			@group(0) @binding(1) var<uniform> otherStruct: OtherStruct;

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> @builtin(position) vec4f {
				let pos = array(
				  vec2f(0.0, 0.5),
				  vec2f(-0.5, -0.5),
				  vec2f(0.5, -0.5),
				);

				return vec4f(pos[vertexIndex] * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
			}

			@fragment fn fs() -> @location(0) vec4f {
				return ourStruct.color;
			}
		`
	});

	const staticUniformBufferSize =
		4 * 4 + // color: vec4f,
		2 * 4 + // offset: vec2f,
		2 * 4;  // padding
	const uniformBufferSize =
		2 * 4;  // scale: vec2f

	const kColorOffset = 0;
	const kOffsetOffset = 4;

	const kScaleOffset = 0;

	const kNumObjects = 100;
	const objectInfos = [];

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

	for (let i = 0; i < kNumObjects; i++) {
		const staticUniformBuffer = device.createBuffer({
			size: staticUniformBufferSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		{
			const uniformValues = new Float32Array(staticUniformBufferSize / Float32Array.BYTES_PER_ELEMENT);
			uniformValues.set([rand(), rand(), rand(), 1], kColorOffset);
			uniformValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset);

			device.queue.writeBuffer(staticUniformBuffer, 0, uniformValues);
		}

		const uniformValues = new Float32Array(uniformBufferSize / Float32Array.BYTES_PER_ELEMENT);
		const uniformBuffer = device.createBuffer({
			size: uniformBufferSize,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: staticUniformBuffer },
				{ binding: 1, resource: uniformBuffer },
			]
		});

		objectInfos.push({
			scale: rand(0.2, 0.5),
			uniformBuffer,
			uniformValues,
			bindGroup,
		});
	}

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

		const aspect = canvas.width / canvas.height;
		for (let { scale, bindGroup, uniformBuffer, uniformValues } of objectInfos) {
			uniformValues.set([scale / aspect, scale], kScaleOffset);
			device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
		}

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
