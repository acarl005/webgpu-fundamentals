import { mat4 } from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";

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

function createBlendedMipmap() {
	const w = [255, 255, 255, 255];
	const r = [255, 0, 0, 255];
	const b = [0, 28, 116, 255];
	const y = [255, 231, 0, 255];
	const g = [58, 181, 75, 255];
	const a = [38, 123, 167, 255];
	const data = new Uint8Array([
		w, r, r, r, r, r, r, a, a, r, r, r, r, r, r, w,
		w, w, r, r, r, r, r, a, a, r, r, r, r, r, w, w,
		w, w, w, r, r, r, r, a, a, r, r, r, r, w, w, w,
		w, w, w, w, r, r, r, a, a, r, r, r, w, w, w, w,
		w, w, w, w, w, r, r, a, a, r, r, w, w, w, w, w,
		w, w, w, w, w, w, r, a, a, r, w, w, w, w, w, w,
		w, w, w, w, w, w, w, a, a, w, w, w, w, w, w, w,
		b, b, b, b, b, b, b, b, a, y, y, y, y, y, y, y,
		b, b, b, b, b, b, b, g, y, y, y, y, y, y, y, y,
		w, w, w, w, w, w, w, g, g, w, w, w, w, w, w, w,
		w, w, w, w, w, w, r, g, g, r, w, w, w, w, w, w,
		w, w, w, w, w, r, r, g, g, r, r, w, w, w, w, w,
		w, w, w, w, r, r, r, g, g, r, r, r, w, w, w, w,
		w, w, w, r, r, r, r, g, g, r, r, r, r, w, w, w,
		w, w, r, r, r, r, r, g, g, r, r, r, r, r, w, w,
		w, r, r, r, r, r, r, g, g, r, r, r, r, r, r, w,
	].flat());
	return generateMips(data, 16);
}

function createCheckedMipmap() {
	const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	const levels = [
		{ size: 64, color: "rgb(128,0,255)", },
		{ size: 32, color: "rgb(0,255,0)", },
		{ size: 16, color: "rgb(255,0,0)", },
		{ size: 8, color: "rgb(255,255,0)", },
		{ size: 4, color: "rgb(0,0,255)", },
		{ size: 2, color: "rgb(0,255,255)", },
		{ size: 1, color: "rgb(255,0,255)", },
	];
	return levels.map(({ size, color }, i) => {
		ctx.canvas.width = size;
		ctx.canvas.height = size;
		ctx.fillStyle = i & 1 ? "#000" : "#fff";
		ctx.fillRect(0, 0, size, size);
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, size / 2, size / 2);
		ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
		return ctx.getImageData(0, 0, size, size);
	});
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

			struct Uniforms {
				matrix: mat4x4f
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
				vsOutput.position = uni.matrix * vec4f(xy, 0.0, 1.0);
				vsOutput.texcoord = xy * vec2f(1, 50);
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

	function createTextureWithMips(mips, label) {
		const texture = device.createTexture({
			label,
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

		return texture;
	}

	const textures = [
		createTextureWithMips(createBlendedMipmap(), "blended"),
		createTextureWithMips(createCheckedMipmap(), "blended")
	];

	const kMatrixOffset = 0;

	const objectInfos = [];
	for (let i = 0; i < 8; i++) {
		const sampler = device.createSampler({
			addressModeU: "repeat",
			addressModeV: "repeat",
			magFilter: (i & 1) ? "linear" : "nearest",
			minFilter: (i & 2) ? "linear" : "nearest",
			mipmapFilter: (i & 4) ? "linear" : "nearest",
		});

		const uniformValues = new Float32Array(16);
		const matrix = uniformValues.subarray(kMatrixOffset, 16);

		const uniformBuffer = device.createBuffer({
			size: uniformValues.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const bindGroups = textures.map(texture => device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: texture },
				{ binding: 2, resource: uniformBuffer },
			]
		}));

		objectInfos.push({
			bindGroups,
			matrix,
			uniformValues,
			uniformBuffer,
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

	let texInd = 0;

	function render() {
		const fov = 60 * Math.PI / 180; // 60 deg in radians
		const aspect = canvas.clientWidth / canvas.clientHeight;
		const zNear = 1;
		const zFar = 2000;
		const projectionMatrix = mat4.perspective(fov, aspect, zNear, zFar);

		const cameraPosition = [0, 0, 2];
		const up = [0, 1, 0];
		const target = [0, 0, 0];
		const viewMatrix = mat4.lookAt(cameraPosition, target, up);
		const viewProjectionMatrix = mat4.multiply(projectionMatrix, viewMatrix);

		renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();

		const encoder = device.createCommandEncoder({ label: "our demo encoder" });
		const pass = encoder.beginRenderPass(renderPassDesc);
		pass.setPipeline(pipeline);

		objectInfos.forEach(({ bindGroups, matrix, uniformValues, uniformBuffer }, i) => {
			const bindGroup = bindGroups[texInd];

			const xSpacing = 1.2;
			const ySpacing = 0.7;
			const zDepth = 50;

			const x = i % 4 - 1.5;
			const y = i < 4 ? 1 : -1;

			mat4.translate(viewProjectionMatrix, [x * xSpacing, y * ySpacing, -zDepth * 0.5], matrix);
			mat4.rotateX(matrix, 0.5 * Math.PI, matrix);
			mat4.scale(matrix, [1, zDepth * 2, 1], matrix);
			mat4.translate(matrix, [-0.5, -0.5, 0], matrix);

			device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

			pass.setBindGroup(0, bindGroup);
			pass.draw(6)
		});

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
			render();
		}
	});

	observer.observe(canvas);

	canvas.addEventListener("click", () => {
		texInd = (texInd + 1) % textures.length;
		render();
	});
}

main()
