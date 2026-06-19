/**
 * @param {RequestInfo | URL} input
 * @returns {Promise<ImageBitmap>}
 */
async function loadImageBitmap(input) {
	const resp = await fetch(input);
	const blob = await resp.blob();
	return createImageBitmap(blob, { colorSpaceConversion: "none" });
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
		label: "our hardcoded RGB triangle shaders",
		code: /* wgsl */`
			struct OurVertexShaderOutput {
				@builtin(position) position: vec4f,
				@location(0) texcoord: vec2f,
			};

		  @vertex fn vs(
				@builtin(vertex_index) vertexIndex: u32
			) -> OurVertexShaderOutput {
				let pos = array(
					// 1st triange
				  vec2f(0.0, 0.0), // center
				  vec2f(1.0, 0.0), // right, center
					vec2f(0.0, 1.0), // center, top

					// 2nd triangle
					vec2f(0.0, 1.0), // center, top
					vec2f(1.0, 0.0), // right, center
					vec2f(1.0, 1.0), // right, top
				);

				var vsOutput: OurVertexShaderOutput;
				let xy = pos[vertexIndex];
				vsOutput.position = vec4f(xy, 0.0, 1.0);
				vsOutput.texcoord = xy;
				return vsOutput;
			}

			@group(0) @binding(0) var ourSampler: sampler;
			@group(0) @binding(1) var ourTexture: texture_2d<f32>;

			@fragment fn fs(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
				return textureSample(ourTexture, ourSampler, fsInput.texcoord);
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

	const url = "https://webgpufundamentals.org/webgpu/resources/images/f-texture.png";
	const source = await loadImageBitmap(url);
	const texture = device.createTexture({
		format: "rgba8unorm",
		size: [source.width, source.height],
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
	});

	device.queue.copyExternalImageToTexture({ source, flipY: true }, { texture }, { width: source.width, height: source.height });

	/** @type {Array<GPUBindGroup>} */
	const bindGroups = [];
	for (let i = 0; i < 8; i++) {
		const sampler = device.createSampler({
			addressModeU: (i & 1) ? "repeat" : "clamp-to-edge",
			addressModeV: (i & 2) ? "repeat" : "clamp-to-edge",
			magFilter: (i & 4) ? "linear" : "nearest",
		});
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: texture },
			]
		});
		bindGroups.push(bindGroup);
	}

	/** @type{GPUSamplerDescriptor} */
	const settings = {
		addressModeU: "repeat",
		addressModeV: "repeat",
		magFilter: "linear",
	};

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
		const bindGroupInd = (settings.addressModeU === "repeat" ? 1 : 0) +
			(settings.addressModeV === "repeat" ? 2 : 0) +
			(settings.magFilter === "linear" ? 4 : 0);
		const bindGroup = bindGroups[bindGroupInd];

		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(6);
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

	/** @type{Array<GPUAddressMode>} */
	const addressOptions = ["repeat", "clamp-to-edge"];
	/** @type{Array<GPUFilterMode>} */
	const filterOptions = ["nearest", "linear"];

	const gui = new dat.GUI({ autoPlace: false });
	Object.assign(gui.domElement.style, { position: "absolute", top: "0", left: "0" });
	document.body.appendChild(gui.domElement);
	gui.add(settings, "addressModeU", addressOptions).onChange(render);
	gui.add(settings, "addressModeV", addressOptions).onChange(render);
	gui.add(settings, "magFilter", filterOptions).onChange(render);
}

main()
