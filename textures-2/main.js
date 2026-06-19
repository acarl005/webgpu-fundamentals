function lerp(a, b, t) {
	return a + (b - a) * t;
}

function mix(a, b, t) {
	return a.map((v, i) => lerp(v, b[i], t));
}

function bilinearFilter(tl, tr, bl, br, t1, t2) {
	const t = mix(tl, tr, t1);
	const b = mix(bl, br, t1);
	return mix(t, b, t2);
};

function createNextMipLevelRgba8Unorm({ data: src, width: srcWidth, height: srcHeight }) {
	// compute the size of the next mip
	const dstWidth = Math.max(1, srcWidth / 2 | 0);
	const dstHeight = Math.max(1, srcHeight / 2 | 0);
	const dst = new Uint8Array(dstWidth * dstHeight * 4);

	const getSrcPixel = (x, y) => {
		const offset = (y * srcWidth + x) * 4;
		return src.subarray(offset, offset + 4);
	};

	for (let y = 0; y < dstHeight; ++y) {
		for (let x = 0; x < dstWidth; ++x) {
			// compute texcoord of the center of the destination texel
			const u = (x + 0.5) / dstWidth;
			const v = (y + 0.5) / dstHeight;

			// compute the same texcoord in the source - 0.5 a pixel
			const au = (u * srcWidth - 0.5);
			const av = (v * srcHeight - 0.5);

			// compute the src top left texel coord (not texcoord)
			const tx = au | 0;
			const ty = av | 0;

			// compute the mix amounts between pixels
			const t1 = au % 1;
			const t2 = av % 1;

			// get the 4 pixels
			const tl = getSrcPixel(tx, ty);
			const tr = getSrcPixel(tx + 1, ty);
			const bl = getSrcPixel(tx, ty + 1);
			const br = getSrcPixel(tx + 1, ty + 1);

			// copy the "sampled" result into the dest.
			const dstOffset = (y * dstWidth + x) * 4;
			dst.set(bilinearFilter(tl, tr, bl, br, t1, t2), dstOffset);
		}
	}
	return { data: dst, width: dstWidth, height: dstHeight };
};

function generateMips(src, srcWidth) {
	const srcHeight = src.length / 4 / srcWidth;

	// populate with first mip level (base level)
	let mip = { data: src, width: srcWidth, height: srcHeight, };
	const mips = [mip];

	while (mip.width > 1 || mip.height > 1) {
		mip = createNextMipLevelRgba8Unorm(mip);
		mips.push(mip);
	}
	return mips;
};

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

			struct Uniforms {
				scale: vec2f,
				offset: vec2f,
			};

			@group(0) @binding(2) var<uniform> uni: Uniforms;

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
				vsOutput.position = vec4f(xy * uni.scale + uni.offset, 0.0, 1.0);
				vsOutput.texcoord = vec2f(xy.x, 1 - xy.y);
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

	const kTextureWidth = 5;
	const kTextureHeight = 7;
	const _ = [255, 0, 0, 255];
	const y = [255, 255, 0, 255];
	const b = [0, 0, 255, 255];
	const textureData = new Uint8Array([
		b, _, _, _, _,
		_, y, y, y, _,
		_, y, _, _, _,
		_, y, y, _, _,
		_, y, _, _, _,
		_, y, _, _, _,
		_, _, _, _, _,
	].flat());

	const mips = generateMips(textureData, kTextureWidth);

	const texture = device.createTexture({
		size: [mips[0].width, mips[0].height],
		mipLevelCount: mips.length,
		format: "rgba8unorm",
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
	});

	mips.forEach(({ data, width, height }, mipLevel) => {
		device.queue.writeTexture(
			{ texture, mipLevel },
			data,
			{ bytesPerRow: width * 4 },
			{ width, height }
		);
	});

	const uniformValues = new Float32Array(2 + 2); // scale, offset
	const kScaleOffset = 0;
	const kOffsetOffset = 2;

	const uniformBuffer = device.createBuffer({
		size: uniformValues.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
	});

	/** @type {Array<GPUBindGroup>} */
	const bindGroups = [];
	for (let i = 0; i < 16; i++) {
		const sampler = device.createSampler({
			addressModeU: (i & 1) ? "repeat" : "clamp-to-edge",
			addressModeV: (i & 2) ? "repeat" : "clamp-to-edge",
			magFilter: (i & 4) ? "linear" : "nearest",
			minFilter: (i & 8) ? "linear" : "nearest",
		});
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: texture },
				{ binding: 2, resource: uniformBuffer },
			]
		});
		bindGroups.push(bindGroup);
	}

	/** @type{GPUSamplerDescriptor} */
	const settings = {
		addressModeU: "repeat",
		addressModeV: "repeat",
		magFilter: "linear",
		minFilter: "linear",
		scale: 1,
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

	function render(time) {
		time *= 0.001;

		const bindGroupInd = (settings.addressModeU === "repeat" ? 1 : 0) +
			(settings.addressModeV === "repeat" ? 2 : 0) +
			(settings.magFilter === "linear" ? 4 : 0) +
			(settings.minFilter === "linear" ? 8 : 0);
		const bindGroup = bindGroups[bindGroupInd];

		const scaleX = 4 / canvas.width * settings.scale;
		const scaleY = 4 / canvas.height * settings.scale;


		uniformValues.set([scaleX, scaleY], kScaleOffset);
		uniformValues.set([Math.sin(time * 0.25) * 0.8, -0.8], kOffsetOffset);

		device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(6);
		pass.end();

		const commandBuffer = encoder.finish();
		device.queue.submit([commandBuffer]);

		requestAnimationFrame(render);
	}
	requestAnimationFrame(render);

	const observer = new ResizeObserver(entries => {
		for (const entry of entries) {
			const canvas = entry.target;
			const width = entry.contentBoxSize[0].inlineSize / 64 | 0;
			const height = entry.contentBoxSize[0].blockSize / 64 | 0;
			canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
			canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
		}
	});

	observer.observe(canvas);

	/** @type{Array<GPUAddressMode>} */
	const addressOptions = ["repeat", "clamp-to-edge"];
	/** @type{Array<GPUFilterMode>} */
	const filterOptions = ["nearest", "linear"];

	const gui = new dat.GUI({ autoPlace: false });
	Object.assign(gui.domElement.style, { position: "absolute", top: "0", left: "0" });
	document.body.appendChild(gui.domElement);
	gui.add(settings, "addressModeU", addressOptions);
	gui.add(settings, "addressModeV", addressOptions);
	gui.add(settings, "magFilter", filterOptions);
	gui.add(settings, "minFilter", filterOptions);
	gui.add(settings, "scale", 0.5, 6);
}

main()
