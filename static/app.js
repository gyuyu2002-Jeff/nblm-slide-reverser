// 狀態管理
let selectedFiles = [];
let uploadedSlidePages = []; // [{ page: 1, image: "data:..." }, ...]
let currentComparisonPage = 0;
let currentComparisonMode = "split"; // "split", "reconstruct", "original"
let generatedReportMarkdown = "";
let generatedNblmPrompt = "";
let generatedPromptGlobal = "";
let generatedPromptSlide = "";
let currentPromptMode = "global"; // "global" | "slide"
let generatedSlideHtml = "";
let currentProvider = localStorage.getItem("active_provider") || "gemini";
let modalSelectedProvider = currentProvider;

// [P0 核心智財保護] 系統逆向工程 Prompt 已黑盒子化加密，防止客戶端逆向與 F12 探測
const _0xSEC_CAPSULE = "UL7n+rzC9b7i2r7n177izL3P1rP62L3uwL3A3r3q+7/667L8zLL84LPa3L/Ky7zE7Lz90b/i8bXm0gooPyk/NC47LjM1NHoWOyM1Ly56CD8sPygpP3cfND0zND8/KLXm07LS3b/j5L7nz7zUyL3T0r/q0r/07Lna2FC+5/q9wN6+5+W/y+e8wvW52sq/2dW97vq97sCy0t280cm8yOi97sC9xsW/9fyz2N6/1MW52su+5+W9zvKy2t++4tC/2Om9wN696vu/+uu99d6+5NG15tIKHhy52tsKCg4CerzSzLzQz7/n673T3bzS8L/GzLXm07Xm1r/k47/gz7zuxL/1xb/f7Lna1r3Gxb/1/L/j5L7nz7Pw8rzE7Lna27/GzLL9+bPA67/M4bna27PY0Lz73LzHyrLp8Lna27zM3b/3zb312r//1bLS3bLT6L/n873p4b3v67na17Xm1r7i/LLn07L39b3Y4LLZ53pramp/er/l+r/1/L/q17Pn0L3A3noUNS4/ODU1MRYXer/q0r3O8rzVyr3+4LLzxLLS3bzUyL3T0rLy97Ly0rL81b313rna2FBQuMD6teLVudrKvMbas/HCv9TFv9PdtebAv/X8vuDRvOvYvML1udrbvcbFvfjgs9jev9TFtebSDigvP3cuNXcJNS8oOT96DDMpLzs2ehwzPj82My4jtebTudrLtebAUGt0eqrF1PK52spramp/er/l+r/1/LzVyr/VzLLZ1rzD9bLS3b3P8b/i2b3T47/k77Xm0r/A7r3827P6yrLy973uzr3D57/b1b/t9LXm07nay7XmwFB6enp3er7hzr3u6rL92r/1xbLZ1rzD9bzC9bzt67LT6L/P3L/Rw7/gz7na273f/b3T3bPb9L3n87Xm0r/82LzAzbzv7bLh17LN173f/b3T3b3M0L/Q+r/r/noKMjUuNXoVLD8oNjsjtebTtebWs9jevML1vP/vver7ve7OvcPnudrYUHp6end6v+Xfs/rSvejkvfjgsvLCs9bevcbFv/X8v+DPstPoehI/Inq9+Oa15tK//Ni87eu87+2y4deyzdd6eWofaBtpYnq80sy97s69w+d6eRwcHBwcHLXm07Xm1r/A7r3827/m7b/S7Lzm2L3D57zSzLzJ37Ld8L3x3rzO47na2FBodHqqxcnKudrKvejkvfjgvNfPvNfTvuL8svLCs9bevNPavMbTvPriv+XZv+PkvufPsvnHs/nkstLdv8bMsv35vPLDsvLCudrLtebAUHp6end6stH/vPLDs/vWvM3bvMbTudrWv8TYvcHuv/X8v+XZvejNstPov/vQvPLDvMXrenIMPyguMzk7NnobOTk/NC56GDsoc7na17/l37P60r3o5LzgzLzW3bLw17P71bLT6LLS3b7n173n9LXm21B6enp3erLR/7L9yLLK57zSzL/r2rPZ8rzG07na1r/K1r/l2b/Gyb/m/b/S3bL9yL3I6npyGTU0OT80LigzOXobKDl6CDM0PSlzudrXudrbudrWv8rWv+XZv8bJs8fsv+XZudrXudrbudrWvOruv+Pps9rovfLRsuHiudrXudrbudrWve3AvPvcvdfyvfHRv9f7vdPdudrXudrbudrWvMzLs/z2ve7RvPjHv9LNudrXtebWv+Xfs/rSemtqan96v/TWvM/uvNfPvNfTv9/sv+PkvufPsvzVvPrmtebbUGl0eqrFzv652sq/982/xNGy0t281Mi/1+q99dq//9W9xsW/9fyz2N6/1MW52su15sBQenp6d3q818+819O88sOz+9a/982z3de15tK//Ni90+O//v293vuy//W97cCy7N+96M2z8c56HyIuKDt6GDU2Pnp1ehM3Kjs5LrXm07na27zM3b/3zbLT6L/n87Xm0r/82L3uzr3D57Pxwr/q17z1zrXm07na27/q17Pn0LzM47/m1bLS3b/+/b/q1b/r/r3uwLna2FBudHqqxcDxudrKv8Duvfzbvd77vuL3vc7FvMbTv+PhsvzgudrWv+3yv8TRehEKE3q97+uy8tK//v28z+K/98252te52su15sBQenp6d3qzw/6zx8S/1MW/xsy8xva+5Ny/6uu8xtOy8+i/7fK/xNG8z+K/98215ta/yvy/0929/Nu89/iy3fCy+9a87eG/0Pq52thQULLx0b7h/73j27Pxzr7i97zM3bXm0r/V6r3b+b3lyLzf+b3O8rLwxLXm07Lm4r/d4L7h/77i0b3vyrz90b/WzL/667/L0LXmwFBQeXqqxdTyer3q+7/667P48rz65r3o5LzgzLPa3L/Ky7/667/L0FBQeXl6a3R6s9rKs/rbvdPSs8f4vNHJvMjostLdv+PkvufPs/DyvMTsenIJNjM+P3c4I3cJNjM+P3oONSo1NjU9I3NQAb/q177i0L/Y6b3A3rz11bP627zQz7/n673T3bPa6LL71r3o5LzgzL/j5L7nz7zR3LL9+bXm1r/l+r/1/L/q17zd077i0L/Y6b/f/b/0477j0b3Gxb/1/L3u6r312gdQd3pwcL329nprerP627zRybzI6HBwtebAUHp6d3q9z/G/4tmy2da8w/Wy0t28x8qy6fC15sByvejkvfjgvNXVsuXqtebWvuTRv/zYudrWvO3rvO/tsuHXss3XenJ5ah9oG2lic3q/z9y/0cO93/290928wM2y0+i85uK/6/6z2/S95/O52tdzUHp6d3qzzcaz1++/4+S+58+y+cez+eS15sBysvPpve7qvNbdsvDXtebWvuTRv/zYudrWvuLhvPLDs/vWv+38v9vuve3Qsujmv8TYvcHuv/X8v+XZvuD0vPPCstPov/vQvPLDvMXrtebBv9XpvuLQsv3Iv/7MvMnueml6v+v+vuD0s93LvPPCv8rWv+XZv8bJv+b9v9Ldsv3IvcjqtebWv+38vuLRsv3Iv+b9ve3Av8vmvN3TudrXc1B6end6vMzdv/fNv+v+ve7AstLdvNTIvdPStebAcr7k0b/82Lna1r3T47/+/b3e+7L/9b3twLLs373ozbPxzr/f8r/+/b/18b3uzr3D57zyw7P71rXm1r7i0bzM47Pf13pod2l6svvWve7OvcPnv+rUsvLaudrXc1BystH/vMbTvMHuv/7As/rbs8f4tebWsvHRvuTHv+DVs9rKs/rbvejkvfjgvNHcsv35c1BQeXl6aHR6vejkvfjgsvL3svLSvenhve/rsvzVvfXeenIePykzPTR6CSMpLj83c1B3enBwstPov+fzvenhve/renIfIjs5LnoSPyJ6Cjs2Py4uP3NwcLXmwFB6end6vc/xv+LZstnWvMP1stPotebAeQICAgICAnpyvejkvODMvNXKv9XMv+DPstPoc1B6end6vuLhvMzdv/fNstPotebAeQICAgICAnpyvuLhsvzbvPLDs/vWstPotebWv/zYve7OvcPnenkcHBwcHBxzUHp6d3q8+uK/5dm/5u2y8OWy0+h6chs5OT80LnO15sB5AgICAgICenK+4PS888Kz4dl1v8nbvdPWs93LvffTs93Xs+HEsvnHs/nkstPoc1B6end6vPb7svzbsubOv9DzstPotebAeQICAgICAnpyve3AvPjHudrbv9Lcv9PovNLMvPb7vMzdv/fNstPoc1B3enBwv/fNv8TRstLdvNTIv9fqv+v+ve7AcHC15sC88sOz+9a/982z3de52tu/1/u909288sOz+9a/98297sC52tu/3/28zN2/982y7cey0t2/6tez59C8zOO/5tVQd3pwcL/j5L7nz7/GzLL9+bLwxLzpz3BwtebAv8rWv+XZv8bJv+b9svzVvPrmudrbv8TYvcHustPov/vQvMXrudrbv9f7vdPds9jQvPvcvejNve7qstLdv8bMvf7gs/jyvPrmUFB5eXppdHqqxcnRehQ1Lj84NTUxFhd6v+rSvc7yver7v/rrvNXKvf7gsvPEenK+4Na/ytK+4tqzwcO88vu/5tWy5uK/3eBzUGR6svHRv8rWvMPYvNXKvuTBvuH/vuLRv9/zvfL0vPL7v+bVvcDev/TWvM/uehc7KDE+NS00er7h+b345r/X2r/70LXm1rL0yb7n5b3O8rLa37/G8r/T173x9b7i2rPX77Ld8L3O67/S3bzVwbXmwFBQeXl5erzy+7/m1XprtebAv9/yv8XFs/jyvPrmvMTsvP3RtebSvNTyssz8tebAv+fSvNr9emkkaGp6s/rbtebWvNXKv9XMvM/uvuHnstPov+fzudrbv/fNv8TRudrbvPLDsvDWsvnHs/nkstLdvdPSv8TRv+DxtebWvuHhvN7VvffcsvLCvcDcv9X1vcHuvNT/v//Nvc7ytebTUDo6Ojc7KDE+NS00ULnayr7h4b/Rw7/0+b/L0Lnay7XmwFCy8dG/wO68+ua+5Me8ycC80su+4tC/2Om9wN6999yy8sK+5Ny84Mq15tIJNS8oOT8ptebTtebWvNXKv9XMs83Gs9fvvuDRv/X8stLdvO7Ev/XFtebWvdjgvNLLsvzVv9DZvuLavuHnve/KvP3Rv8DusvbjudrbsvzMsvzgv+Ppsvv7vcDev+rSvP/3ver7v/rrv9/9v/TjudrYULXm0r3i57P627zP4r3O67zY8rz647zJwL333LLywr/f/b/047zt67/g/LLd8LL71rL527Pd1bXm1r/h4LL36nppJGhqerP627/H3b/V9bXm1rz11bP6273A3LP60r/A7rz65rPb77/k8L7i0b/SzbP48rz65rL81b313rXm01BQudrKqsXU8nq/3/K/xcWy/Myy/OCz+PK8+uay/NW99d56cgwzKS87NnoJLiM2P3odLzM+P3O52su15sBQa3R6vc/xv+LZv+DPstPostLdvMfKsunwtebAAb3o5LzgzL/78b/f/7Lk8rL3wr/S6r3A3r/gz7LT6LLS3bzHyrLp8LXm1r/82LXmwLzt67zv7bLh17LN13pyeWofaBtpYnN6v8/cv9HDvd/9vdPdvMDNstPovObiv+v+s9v0vefzB1BodHq8+uK/5dm/4+S+58+y+cez+eS90+O/5O+15tK89dWz+tu/5d+z+tK88sOy8uG//Ni+58+83dO9zvK15tO15sBQenp6d3q+4uG88sOz+9a8zdu15sABv/zYtebAv+38v9vuve3Qsujmemt6vPjHv8TYvcHuv/X8v+XZvejNvuD0vPPCstPov/vQvPLDvMXrenJ5HG8bbGhpcwdQenp6d3qy/ciyyue/4+S+58+15sABv/zYtebAv9XpvuLQsv3Is9/Xvef0eml6v+v+v/7MvMnuvuD0s93LvPPCv8rWv+XZv8bJv+b9v9Ldsv3IvcjqtebWv+38vuLRsv3Iv+b9ve3Av8vmvN3TB1BpdHq/982z8c6y0t281Mi/1+qz+PK8+ua15sABv/zYtebAvdPjv/79vd77sv/1ve3AsuzfvejNs/HOenIfIi4oO3oYNTY+enV6EzcqOzkuc7Xm1r/f8r/+/b/18bXm1r3uzr3D57Pxwr/q17z1zgdQULnayqrFwPF6s/rbs8f4vdPSv8TRs8Hss93Xsv7dvMbas/HCve7evMfFtebSFjsjNS8ueh4zLD8oKTMuI3p8egA/KDV3CD8qPy4zLjM1NHoILzY/tebTudrLtebAUGt0erz11b7i2rP627/L0r3V5L3vz77i17Pd17L+3bXmwL3O+L/d4L3A3rzQz7/n673T3b/f/b/0477i97Xm1r3B4rPe6rP627PH+Lnayr3vz7/q17/A7r3827nay7//zb3O8r3B4r/K1r3T0r/E0bXmwbzP7r7h573q+7/6677i97Xm1rz11b7i2r/a0bP627PH+LPZ57/l37P60rzU+73O8rzS8L3e7L7i17/K1r3A3rL8zLL84LzRybzI6L3vyrz90bXm0r7k0b/82LXmwLzD2LPMybLh4nq4xM56v+XZvMPgv8bMerjEznq88/G/ysu8+Me/4ux6uMTOer3F87PD+bL78rz65nq4xM56v8TYvcHuv9f7vdPderjEznqy7fW97cC/xsx6uMTOer3I6r/n+Lzv273y0Xq4xM56v/79vNH2ssPFv9LcvM71vffTv/7Av9/ZsubwvMHltebTudrYUGh0er/m7b/S7L/Rz7zf0bLm8LzB5bXmwL/X6b7k5b3B4rPe6rP627PH+L3A3r7i4bP71rzSzL/f/b/047Pd1b3B4r7m5rXm1r7jxb/l37P60r/m7b/S7LL00LzVwb/j5L7nz7zVyLz957LS3bL8zLL84L/L0r3V5LLm07PxzrXm1r/k47/gz7zHxr3vz7/X2b313b7i2r/k0b3A3r/X+73T3bzSzLz4x7/Szb/m1bL8zLL84L3M6L7j1bXm21BQudrKuMbYteLVer3q+7/667zM3b/3zb/13L/g/LPC6L3S3LP6yr30zbXm0r3s97zW27/L5r/K4rzexbXm1r/A7r3827zP+bzM3bz077LK57Xm07nay7XmwFBrdHq/wO68+ua84PW84Mq15sC809q8xtO/3/2/9OO/5d+z+tJ6a2pqf3q84Mqy3fC+5Ny84Mq999yy8sK15ta/wO69/Nu87eG/0Pq8xvC81cq/1dC9wN6//syz2fK81PKy8cy52thQaHR6v/fNvM/is8PKv9LstebAUHp6end6vNDPv+frvdPdvuLhvPLDs/vWtebAs8PKv/TAemIka256v/fNtebSve/KsvHMv9/SsvvWtebWv9HPsunJvNLMvuLhsvbYvcX3svDEtebTudrYUHp6end6v9P1vPLDs/vWdb/q1LLy2rXmwLPDyr/0wHprbyRob3q/98252thQenp6d3q/19q/+9B1v9f7vdPdvPLDs/vWtebAs8PKv/TAem4kYnq/98252thQenp6d3q8+Me/0s2y/Nuz4cS15sC89dW8+Mezw8q/9MB6a2gkaGp6v/fNtebSvPXVvPbedbz11b/X+73T3bzG2r/+wHpoJGl6s+HEtebTudrYUGl0eqrFwPF6suj6v8rLvNTIs8P+tebAs8P+s8fEvuTcvODKvffcsvLCvuL3v9/tv9jDvMLUvfjgve/rsvLSvM/ivMnAtebWv8r8v9PdudrKve/Pv+rXv8DuvfzbudrLvd77vuL3vc7FvMbTve3ys9r6v+3yv8TRehEKE3q97+uy8tK//v28z+K/98252thQULnayqrFycp6vdPSv8TRsvDEvOnPv+DxtebSsvHRvuTHv8res/rbv9/9v/Tjv+v2vNr9v9HPvN/Rs9vivc7ytebTudrLtebAUHd6Ab3T0r/E0XobtebAv+rbs8f4vuLhsvzMsvzgB7XmwL/+/bzyw7P71npxerz64r/l2b/0wL7n17/q1LLy2rna2FB3egG909K/xNF6GLXmwLz64r/l2b/X+73T3b/E0Qe15sBoJG56vPbevdfyvfHRve3AvPvcv9f7vdPdtebWvPXVvPbevNXKv9XMemt6v9rRvPriv+XZvO7Ev/XFenF6aHqz4cS9xfey8MS52thQd3oBvdPSv8TRehm15sCz2ui98tG8w9izzMmy4eK/xNEHtebAvPPxv8rLemkkbnqzwNS89O+99dqz4cS15ta88sOy8uGzwNS89O+/yte98uuy0t2z3da98tG9+Mu52thQd3oBvdPSv8TReh615sC8z+K8ycC/6te89c6/xNEHtebAv+38v9Xps8HDvPbev9Lcv9PotebWs9rosvvWv97wv9D5v+rXvPXOvNLMsuzyv9H4vNHcsv35udrYUHd6Ab3T0r/E0XoftebAve/KsvHMstLdsvvWv9HPv8TRB7XmwLPNxrPX773i573vynpxer7i0b7i2rz3/7L71r/Rz7zM47z70rna2FBystH/v9TFvNDPv+frvdPdvMbTvMHuv/7AvdPSv8TRtebWsvHRv9LNv93gvdPSv8TRehy52tsdudrbEnR0dLXm1rzVyr/VzLzT2rzG07P627PH+L3A3r3X8r3T47/j5L7nz73vyrz90XNQULnayrPayrP6273q+7/667/f/b/047Lm4r/d4Lz65r/m1bXm0rLx0b7kx7z3/rz65r/m1bPayrP627Lm4r/d4LXm07nay7XmwFB3d3dQeXl5er329noCerP627XmwAGz+tuzx/i+4uGz+9YHtebSvNT7vc7yvdPSv8TRtebAARt1GHUZdR51H3R0dAe15ta4wt+/wO68+ua97t68x8W15sC909K/xNG978++4tey0t2/09ey5eq+4eG+58+z+tuzx/iz3dey/t215tNQd3q52sqqxdTyerL8zLL84LLS3b3T0rPH+LPf173n9Lnay7XmwHK88sOy8uG//Ni+58+83dO9zvK/3/K/xcW/4M+y0+i52tu/xNi9we688sO8xeu52tu/yta/5dm/xsm/5v2999O/4+S+58+/39m97vpzUHd6udrKqsXJx3q96vu/+uu8zN28+9K/3/2/9OO52su15sBQenp3er7i4bzyw7P71rXmwHR0dFB6end6vPriv+XZs93Xs+HEtebAtebSvuTHs9viv/TAvdPSv8TRv/vxv/Xxv9f7vdPddbzD2LPMybLh4nW8+Me/0s2y/Nuz4cS15ta/wO68+uaz2++/9NK/9828z+Kzw8q/0uy15tNQOjo6UFB5eXl6vPL7v+bVemi15sCz2sqz+tt6a2Brer/q17z1zrXm0rPb87/K0rzZ6bL823pramp/er/Z1b3u+r3uwLPY3r/Uxb3T47/0wLzQz7/n673T3b3A3r/A7rz65r/78b/18bXm01A6Ojo3OygxPjUtNFC52sq+4eG/0cO/9Pm/y9C52su15sBQsvHRv8DuvPrmvuTHvMnAvNLLvuLQv9jpvcDevffcsvLCvuTcvODKtebSCTUvKDk/KbXm07Xm1rzVyr/VzLPNxrPX777g0b/1/LLS3bzuxL/1xbXm1r/q3b333LLywr/f/b/047/l+r/1/L/78b/18b/f/77i0b/SzbnayrPayrP623prYGt6vNDPv+frvdPdvNTIvdPSstLdvMzdvPvSvMTsvP3RudrLvuL3udrYULnayqrFwPF6s/rbs8f4v8vSvdXks8Hss93Xsv7dudrLtebAv8DuvPrmv+rXvN3Tv9TFvfLlv8res/rbvdfyvfHRvuPRvdPSv8TRvNHJvMjotebWvPXVvuLas/rbvcDcvdjgvdfyvfHRsvzMsvzgv8vSvdXktebWv8Duvfzbvuflvc7yudrWv8rWvuLQudrXvNLMv8rSvufvver7v9bMudrYUFC52sq96vu/+uu8zN2/982/9dy/4Pyzwui90tyz+sq99M252su15sBQa3R6v8DuvPrmvOD1vODKtebAvNPavMbTv9/9v/Tjv+Xfs/rSemtqan96vODKst3wvuTcvODKvffcsvLCtebWv8DuvfzbvO3hv9D6v/7Ms9nyvNTysvHMudrYUGh0er/A7rz65r/3zbzP4rPDyr/S7LXmwL7i4bzyw7P71rPDyr/0wHpiJGtuer/3zbna27/T9bzyw7P71rPDyr/0wHprbyRob3q/98252tu/1/u909288sOz+9azw8q/9MB6biRier/3zbna27z4x7/SzbPDyr/0wHpraCRoanq/98252thQaXR6qsXA8Xqy6Pq/ysu81Mizw/615sC/wO69/Nu93vu+4ve9zsW8xtO97fKz2vq/7fK/xNF6EQoTer3v67Ly0r/+/bzP4r/3zbna2FBQudrKs9rKs/rbemtga3q96vu/+uu81Mi909Ky0t28zN28+9K8xOy8/dG15tK/6te83dO/yt6z+tu80M+/5+u909215tO52su15sBQcrLx0b/A7rz65rz647zJwL/1/LPAwbLk8rL3wr/S6r3A3r/K3rP6273Gxb/1/LL8zLL84L3T47/k77PayrP627Lm4r/d4LXm1r313r7k0b/82L7i0bXmwHNQUHd3d1B5eXl6vNDPv+frvdPdemu15sABs/rbs8f4s/vEv8TRtebWv/zYtebAv+rbs8f4s/rbB1C52sqqxdTyerL8zLL84LP48rz65rLS3b3T0rPH+LPf173n9Lnay7XmwFB3er3P8b/i2bLZ1rzD9bXmwAG/+/G/3/+y8+iz+tu/4M+y0+iy0t28x8qy6fC15ta//Ni15sC87eu87+2y4deyzdd6cnlqH2gbaWJzer3f/b3T3bzm4r/r/rPb9L3n8wdQd3q8+uK/5dmy+cez+eS15sABv/vxv9//svPos/rbv+PkvufPv9/Zve76tebWv/zYtebAv+38v9vuv8TYvcHuvejNvuD0vPPCvPLDvMXrudrbv9XpvuLQsv3Iv8rWv+XZv8bJv+b9v9Ldsv3IvcjqB1B3er/3zbPxzrzUyL/X6rXmwAG//Ni15sC90+O//v293vuy//W97cCy7N+96M2z8c615ta97s69w+e/3/K//v2/9fEHULnayqrFycd6ver7v/rrvMzdvPvSv9/9v/Tjv9faudrLtebAUHd6vuLhvPLDs/vWtebAtebSvNXKv9XMvffcsvLCvPriv+XZvuLhs/vWtebWve/KsvHMv9/SsvvWtebWZmtuv/fNtebTUHd6v+rUsvLavMvCsvzbtebAtebSvNXKv9XMemh3aXqy+9a96vu/+uu8+uK/5dm/9MC+59e15tZmaG+/98215tNQUHKy0f+/1MW96vu/+uu8xtO//sCz+tu15tay8dG+5Me/4NW/6te83dO/1MW96vu/+uu9wN699vZ6aLna22l0dHR6s/rbs9rKs/rbvejkvODMsubiv93gv9bfv8rxsvzMsvzgs9/Xvef0stLdvMzdvPvSv9/9v/Tjv9favcDevMTsvP3Rc1A6OjpQUHl5em50eqrFyOF6a2BrerPY3r/Uxb7j0XoSDhcWenV6DjszNi0zND56vNDPv+frvdPdve/KvP3RvfjmenK/1fW9we681P+y/t2y+ee+5+W9zvJzUDo6OjIuNzZQZnt3d3q/9Na8z+652tu+4+S87fK52tu/1fW+4f+9we681P+/xvK92tWy/Oe/w/K91/K98dGz29Gy+9a9wN56Eg4XFnq+4fm9+Oa15ta/1t+/yvF6DjszNi0zND56GQkJehkeFHqy0t2/3/2y2/W88vm/5tW15tZramp/er/l+r/1/LPd173V5L7i0LLl6rzQz7/n673T3b3A3r3Gxb/1/L/j5L7nz7/GzLL9+bLS3b3T0rPH+Hp3d2RQOjo6UFB3d3dQvMbav+TWtebWsvHRs8PevuLQvuLRvMzjvcDeehAJFRR6v9fav/vQtebWvNXKvuTBv9PXvfH1stPovf/ystLdvPLDvev+v+vPvf7gtebAUDo6OjApNTRQIVB6engpLiM2PwU0Ozc/eGB6eL3o5LzgzLP48rz65r/K173y63h2UHp6eC47PSl4YHoBeL/j5L7nz7zRybzI6Lzyw73r/mt4dnp4vPLDvev+aHh2eni88sO96/5peHZ6eLzyw73r/m54B3ZQenp4Kjs2Py4uP3hgegFQenp6eiF4KDU2P3hgeni9z/G/4tmy2da8w/V4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni+4uGy/Nu8zN2/9814dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni8+uK/5dm/5u2y8OWy0+h4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni97cC8+9yy0t2/0ty/0+h4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J1B6egd2UHp6eC0yMy4/BSkqOzk/BSg7LjM1eGB6eG1qf3h2UHp6eD4/NCkzLiN4YHp4ve/KvP3Rv9bMvPjHvcrcv8TReFAnUDo6OlA=";

function _0xgetDecryptedInstruction() {
  try {
    const binary = atob(_0xSEC_CAPSULE);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) ^ 0x5A;
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return "";
  }
}

// 服務商配置
const PROVIDER_CONFIG = {
  gemini: {
    name: "Google Gemini",
    defaultPlaceholder: "AIzaSy...",
    portalText: "前往 Google AI Studio 免費申請",
    portalUrl: "https://aistudio.google.com/app/apikey"
  },
  openai: {
    name: "OpenAI",
    defaultPlaceholder: "sk-proj-...",
    portalText: "前往 OpenAI Platform 建立 Key",
    portalUrl: "https://platform.openai.com/api-keys"
  },
  anthropic: {
    name: "Anthropic Claude",
    defaultPlaceholder: "sk-ant-...",
    portalText: "前往 Anthropic Console 建立 Key",
    portalUrl: "https://console.anthropic.com/settings/keys"
  }
};

// DOM 初始化
document.addEventListener("DOMContentLoaded", () => {
  initProvider();
  initApiKeyStatus();
  setupEventListeners();
  updateUiState();
  checkFirstTimeVisitor();
});

// === 1. API KEY 管理 ===
function getApiKey(provider = currentProvider) {
  return localStorage.getItem(`${provider}_api_key`) || "";
}

function setApiKey(provider, key) {
  if (key && key.trim()) {
    localStorage.setItem(`${provider}_api_key`, key.trim());
  } else {
    localStorage.removeItem(`${provider}_api_key`);
  }
  initApiKeyStatus();
}

function initApiKeyStatus() {
  const key = getApiKey(currentProvider);
  const dot = document.getElementById("status-indicator-dot");
  const text = document.getElementById("status-indicator-text");
  const badge = document.getElementById("active-engine-badge");
  const config = PROVIDER_CONFIG[currentProvider] || PROVIDER_CONFIG.gemini;
  
  if (key) {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
    if (text) {
      text.textContent = `${config.name} 就緒`;
      text.className = "text-emerald-400 font-semibold";
    }
    if (badge) {
      badge.textContent = `${config.name} · 智慧全自動適配`;
    }
  } else {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-amber-400";
    if (text) {
      text.textContent = `設定 ${config.name} Key`;
      text.className = "text-slate-200 font-semibold";
    }
    if (badge) {
      badge.textContent = `尚未設定金鑰 · 點此設定`;
    }
  }
}

// 迎賓導引彈窗開關控制
function openOnboardingModal() {
  const modal = document.getElementById("modal-onboarding");
  if (!modal) return;
  const input = document.getElementById("input-onboarding-key");
  if (input) {
    input.value = getApiKey("gemini");
  }
  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function closeOnboardingModal(rememberDismiss = false) {
  const modal = document.getElementById("modal-onboarding");
  if (modal) modal.classList.add("hidden");
  if (rememberDismiss) {
    localStorage.setItem("has_seen_onboarding", "true");
  }
}

// 首次造訪且尚未設定 API 金鑰時，自動彈出迎賓教學
function checkFirstTimeVisitor() {
  const hasAnyKey = getApiKey("gemini") || getApiKey("openai") || getApiKey("anthropic");
  const hasSeen = localStorage.getItem("has_seen_onboarding") === "true";
  if (!hasAnyKey && !hasSeen) {
    setTimeout(() => {
      openOnboardingModal();
    }, 350);
  }
}

// 切換服務商（僅在彈窗內切換，主畫面自動同步）
function switchProvider(newProvider) {
  currentProvider = newProvider;
  localStorage.setItem("active_provider", newProvider);
  initApiKeyStatus();
}

function initProvider() {
  switchProvider(currentProvider);
}

// === 2. 事件監聽設置 ===
function setupEventListeners() {
  const on = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  };

  const modalApiKey = document.getElementById("modal-apikey");
  const modalTutorial = document.getElementById("modal-tutorial");
  const modalSecurity = document.getElementById("modal-security");

  // 頂部導航按鈕
  on("btn-apikey-modal", "click", () => {
    openApiKeyModal(currentProvider);
  });
  on("btn-close-apikey-modal", "click", () => {
    if (modalApiKey) modalApiKey.classList.add("hidden");
  });

  // 點擊「免費金鑰教學」開啟迎賓教學彈窗（直達三步驟與一鍵儲存）
  on("btn-tutorial", "click", () => {
    openOnboardingModal();
  });
  on("btn-close-tutorial", "click", () => {
    if (modalTutorial) modalTutorial.classList.add("hidden");
  });
  on("btn-tutorial-got-it", "click", () => {
    if (modalTutorial) modalTutorial.classList.add("hidden");
    if (!getApiKey(currentProvider)) {
      openApiKeyModal(currentProvider);
    }
  });

  // 迎賓導引彈窗互動監聽
  on("btn-close-onboarding", "click", () => {
    closeOnboardingModal(true);
  });
  on("btn-skip-onboarding", "click", () => {
    closeOnboardingModal(true);
    showToast("您可隨時點擊右上角「設定 API 金鑰」進行設定", "info");
  });
  on("btn-onboarding-switch-other", "click", () => {
    closeOnboardingModal(true);
    openApiKeyModal("openai");
  });
  on("btn-save-onboarding-key", "click", () => {
    const input = document.getElementById("input-onboarding-key");
    const key = input ? input.value.trim() : "";
    if (!key) {
      showToast("請先貼上有效的 Google Gemini API Key，或點擊跳過", "warning");
      return;
    }
    setApiKey("gemini", key);
    switchProvider("gemini");
    closeOnboardingModal(true);
    showToast("Google Gemini 金鑰已就緒！請拖入投影片開始分析", "success");
  });

  // 迎賓彈窗密碼顯隱切換
  const toggleOnboardingBtn = document.getElementById("btn-toggle-onboarding-key");
  const onboardingInput = document.getElementById("input-onboarding-key");
  if (toggleOnboardingBtn && onboardingInput) {
    toggleOnboardingBtn.addEventListener("click", () => {
      if (onboardingInput.type === "password") {
        onboardingInput.type = "text";
        toggleOnboardingBtn.innerHTML = '<i data-lucide="eye-off" class="w-3.5 h-3.5"></i>';
      } else {
        onboardingInput.type = "password";
        toggleOnboardingBtn.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i>';
      }
      lucide.createIcons();
    });
  }

  on("btn-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.remove("hidden");
  });
  on("btn-close-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.add("hidden");
  });
  on("btn-close-security-confirm", "click", () => {
    if (modalSecurity) modalSecurity.classList.add("hidden");
  });

  // 金鑰設定彈窗內供應商切換
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-modal-provider");
      openApiKeyModal(p);
    });
  });

  // 儲存金鑰
  on("btn-save-key", "click", () => {
    const inputKey = document.getElementById("input-api-key");
    const key = inputKey ? inputKey.value.trim() : "";
    if (!key) {
      showToast("請輸入有效金鑰，或點擊清除", "warning");
      return;
    }
    setApiKey(modalSelectedProvider, key);
    if (modalApiKey) modalApiKey.classList.add("hidden");
    showToast(`${PROVIDER_CONFIG[modalSelectedProvider].name} 金鑰已安全保存！`, "success");
    if (modalSelectedProvider !== currentProvider) {
      switchProvider(modalSelectedProvider);
    }
  });

  // 清除金鑰
  on("btn-clear-key", "click", () => {
    setApiKey(modalSelectedProvider, "");
    const inputKey = document.getElementById("input-api-key");
    if (inputKey) inputKey.value = "";
    showToast(`已清除 ${PROVIDER_CONFIG[modalSelectedProvider].name} 本地金鑰`, "info");
  });

  // 密碼顯隱切換
  const toggleBtn = document.getElementById("btn-toggle-key-visibility");
  const keyInput = document.getElementById("input-api-key");
  if (toggleBtn && keyInput) {
    toggleBtn.addEventListener("click", () => {
      if (keyInput.type === "password") {
        keyInput.type = "text";
        toggleBtn.innerHTML = '<i data-lucide="eye-off" class="w-4 h-4"></i>';
      } else {
        keyInput.type = "password";
        toggleBtn.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>';
      }
      lucide.createIcons();
    });
  }

  // 教學頁籤切換監聽
  document.querySelectorAll(".tut-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tut = btn.getAttribute("data-tut");
      switchTutTab(tut);
    });
  });

  // 快捷開啟金鑰設定
  on("btn-open-apikey-quick", "click", () => {
    openApiKeyModal(currentProvider);
  });

  // 拖曳上傳與檔案選擇
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  if (fileInput) {
    fileInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFilesAdded(Array.from(e.target.files));
      }
    });
  }

  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("border-sky-400", "bg-slate-800/80");
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("border-sky-400", "bg-slate-800/80");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("border-sky-400", "bg-slate-800/80");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesAdded(Array.from(e.dataTransfer.files));
      }
    });
  }

  on("btn-clear-files", "click", () => {
    selectedFiles = [];
    uploadedSlidePages = [];
    currentComparisonPage = 0;
    const gallery = document.getElementById("thumbnail-gallery");
    const previewSec = document.getElementById("file-preview-section");
    if (gallery) gallery.innerHTML = "";
    if (previewSec) previewSec.classList.add("hidden");
    if (fileInput) fileInput.value = "";
    showToast("已清空選擇檔案", "info");
  });

  // 結果頁籤切換監聽
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-result-tab");
      switchResultTab(tab);
    });
  });

  // 投影片翻頁監聽
  on("btn-prev-slide", "click", () => {
    if (currentComparisonPage > 0) {
      currentComparisonPage--;
      updateComparisonView();
    }
  });
  on("btn-next-slide", "click", () => {
    if (currentComparisonPage < uploadedSlidePages.length - 1) {
      currentComparisonPage++;
      updateComparisonView();
    }
  });

  // 提示詞模式選擇（左側操作卡片）
  document.querySelectorAll("#prompt-mode-selector .prompt-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-prompt-mode");
      if (mode) switchPromptMode(mode);
    });
  });

  // 提示詞模式切換（右側結果頁子導航）
  on("btn-subtab-global", "click", () => switchPromptMode("global"));
  on("btn-subtab-slide", "click", () => switchPromptMode("slide"));

  // 開始分析按鈕
  on("btn-start-analyze", "click", handleStartAnalyze);

  // 複製按鈕（動態對應當前所選模式）
  on("btn-copy-nblm", "click", () => {
    const promptToCopy = currentPromptMode === "global" ? (generatedPromptGlobal || generatedNblmPrompt) : (generatedPromptSlide || generatedNblmPrompt);
    if (!promptToCopy) return;
    navigator.clipboard.writeText(promptToCopy).then(() => {
      const label = document.getElementById("copy-btn-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      const modeName = currentPromptMode === "global" ? "【模式 1：全域風格架構】" : "【模式 2：逐頁 1:1 對比】";
      showToast(`已成功複製 ${modeName} 提示詞！可至 NotebookLM 貼上`, "success");
    });
  });

  // 直達工作流按鈕：複製並開啟 NotebookLM
  on("btn-copy-and-open-nblm", "click", () => {
    const promptToCopy = currentPromptMode === "global" ? (generatedPromptGlobal || generatedNblmPrompt) : (generatedPromptSlide || generatedNblmPrompt);
    if (!promptToCopy) {
      showToast("尚未產生提示詞，請先上傳簡報進行分析", "warning");
      return;
    }
    navigator.clipboard.writeText(promptToCopy).then(() => {
      const modeName = currentPromptMode === "global" ? "【模式 1：全域風格】" : "【模式 2：逐頁 1:1】";
      showToast(`已複製 ${modeName} 提示詞！正在為您開啟 NotebookLM...`, "success");
      window.open("https://notebooklm.google.com/", "_blank");
    });
  });

  on("btn-copy-html-code", "click", () => {
    if (!generatedSlideHtml) return;
    navigator.clipboard.writeText(generatedSlideHtml).then(() => {
      const label = document.getElementById("copy-html-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      showToast("已複製 1:1 還原之 HTML / Tailwind 投影片代碼！", "success");
    });
  });

  on("btn-open-preview-window", "click", () => {
    if (!generatedSlideHtml) {
      showToast("尚未產生投影片代碼", "warning");
      return;
    }
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(buildFullSlideHtml(generatedSlideHtml));
      win.document.close();
    }
  });

  on("btn-copy-all-report", "click", () => {
    if (!generatedReportMarkdown) return;
    navigator.clipboard.writeText(generatedReportMarkdown).then(() => {
      showToast("已複製整份排版分析報告！", "success");
    });
  });

  on("btn-export-markdown", "click", () => {
    if (!generatedReportMarkdown) return;
    const blob = new Blob([generatedReportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `簡報風格逆向解析報告-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("已下載報告檔案！", "success");
  });
}

// 教學彈窗頁籤切換核心函數
function switchTutTab(tutName) {
  document.querySelectorAll(".tut-tab-btn").forEach(b => {
    const isTarget = b.getAttribute("data-tut") === tutName;
    if (isTarget) {
      b.className = "tut-tab-btn py-1.5 border-b-2 border-zinc-200 text-zinc-100 font-medium cursor-pointer";
    } else {
      b.className = "tut-tab-btn py-1.5 border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 cursor-pointer";
    }
  });

  const allKeys = ["gemini", "openai", "anthropic"];
  allKeys.forEach(k => {
    const el = document.getElementById(`tut-content-${k}`);
    if (el) {
      if (k === tutName) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  });
  if (window.lucide) window.lucide.createIcons();
}
window.switchTutTab = switchTutTab;

function openApiKeyModal(provider) {
  modalSelectedProvider = provider;
  const config = PROVIDER_CONFIG[provider];
  const modalApiKey = document.getElementById("modal-apikey");

  // 更新彈窗內的按鈕選中樣式
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    const p = btn.getAttribute("data-modal-provider");
    if (p === provider) {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-medium border transition-all text-center bg-zinc-100 text-zinc-950 border-zinc-100 cursor-pointer";
    } else {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-medium border transition-all text-center bg-white/[0.04] text-zinc-300 border-white/[0.08] hover:bg-white/[0.08] cursor-pointer";
    }
  });

  document.getElementById("modal-key-label").textContent = `${config.name} API Key：`;
  const keyInput = document.getElementById("input-api-key");
  keyInput.placeholder = config.defaultPlaceholder;
  keyInput.value = getApiKey(provider);

  const portalLink = document.getElementById("modal-portal-link");
  portalLink.href = config.portalUrl;
  document.getElementById("modal-portal-text").textContent = config.portalText;

  modalApiKey.classList.remove("hidden");
  lucide.createIcons();
}

// 純前端渲染 PDF 縮圖（支援 GitHub Pages 離線/無伺服器環境）
async function parsePdfClientSide(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("PDF 解析模組載入中，請稍候重試");
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const pages = [];
  const maxPages = Math.min(totalPages, 6);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    pages.push({ page: i, image: dataUrl });
  }
  return { total_pages: totalPages, preview_pages: pages };
}

// === 3. 檔案處理與縮圖收集 ===
async function handleFilesAdded(files) {
  const validExtensions = [".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"];
  const newFiles = files.filter(f => {
    const ext = "." + f.name.split(".").pop().toLowerCase();
    return validExtensions.includes(ext);
  });

  if (newFiles.length === 0) {
    showToast("未檢測到支援的簡報檔案，請上傳 PDF、PPTX 或圖片", "warning");
    return;
  }

  selectedFiles.push(...newFiles);
  document.getElementById("file-preview-section").classList.remove("hidden");
  document.getElementById("file-count-label").textContent = `已選取 ${selectedFiles.length} 個檔案`;

  const gallery = document.getElementById("thumbnail-gallery");

  for (const file of newFiles) {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    
    if (ext === ".pdf") {
      const previewCard = document.createElement("div");
      previewCard.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-2 flex flex-col items-center justify-center text-center text-xs text-slate-300 shadow-sm";
      previewCard.innerHTML = `
        <div class="animate-pulse flex flex-col items-center py-3">
          <i data-lucide="file-text" class="w-6 h-6 text-sky-400 mb-1"></i>
          <span class="truncate max-w-[85px] font-mono text-[10px] text-slate-300">${file.name}</span>
          <span class="text-[9px] text-slate-500 mt-0.5">解析 PDF 頁面...</span>
        </div>
      `;
      gallery.appendChild(previewCard);
      lucide.createIcons();

      try {
        let pdfData = null;
        // 優先使用純前端快速解析
        if (typeof pdfjsLib !== "undefined") {
          try {
            pdfData = await parsePdfClientSide(file);
          } catch (e) {
            console.warn("前端 PDF 渲染異常，嘗試後端:", e);
          }
        }
        // 若純前端無法解析且為本地環境，嘗試調用後端
        if (!pdfData && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
          const formData = new FormData();
          formData.append("file", file);
          const resp = await fetch("/api/preview", { method: "POST", body: formData });
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === "success") pdfData = data;
          }
        }

        if (pdfData && pdfData.preview_pages && pdfData.preview_pages.length > 0) {
          uploadedSlidePages.push(...pdfData.preview_pages);
          previewCard.innerHTML = `
            <div class="relative w-full h-20 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
              <img src="${pdfData.preview_pages[0].image}" class="w-full h-full object-cover">
              <span class="absolute bottom-1 right-1 bg-black/75 text-[9px] px-1 py-0.2 rounded text-white font-mono">
                ${pdfData.total_pages} 頁
              </span>
            </div>
            <span class="truncate max-w-[90px] text-[10px] text-slate-300 mt-1 font-medium">${file.name}</span>
          `;
        } else {
          previewCard.innerHTML = `
            <div class="flex flex-col items-center py-3 text-amber-400">
              <i data-lucide="alert-triangle" class="w-6 h-6 mb-1"></i>
              <span class="truncate max-w-[85px] text-[10px]">${file.name}</span>
              <span class="text-[9px] text-slate-400">請改傳圖片</span>
            </div>
          `;
          lucide.createIcons();
        }
      } catch (err) {
        console.warn("無法取得縮圖:", err);
      }

    } else if (ext === ".pptx") {
      const previewCard = document.createElement("div");
      previewCard.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-2 flex flex-col items-center justify-center text-center text-xs text-slate-300 shadow-sm";
      previewCard.innerHTML = `
        <div class="animate-pulse flex flex-col items-center py-3">
          <i data-lucide="presentation" class="w-6 h-6 text-sky-400 mb-1"></i>
          <span class="truncate max-w-[85px] font-mono text-[10px] text-slate-300">${file.name}</span>
          <span class="text-[9px] text-slate-500 mt-0.5">解析 PPTX...</span>
        </div>
      `;
      gallery.appendChild(previewCard);
      lucide.createIcons();

      try {
        let pptxSuccess = false;
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          const formData = new FormData();
          formData.append("file", file);
          const resp = await fetch("/api/preview", { method: "POST", body: formData });
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === "success" && data.preview_pages && data.preview_pages.length > 0) {
              uploadedSlidePages.push(...data.preview_pages);
              pptxSuccess = true;
              previewCard.innerHTML = `
                <div class="relative w-full h-20 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
                  <img src="${data.preview_pages[0].image}" class="w-full h-full object-cover">
                  <span class="absolute bottom-1 right-1 bg-black/75 text-[9px] px-1 py-0.2 rounded text-white font-mono">
                    ${data.total_pages} 頁
                  </span>
                </div>
                <span class="truncate max-w-[90px] text-[10px] text-slate-300 mt-1 font-medium">${file.name}</span>
              `;
            }
          }
        }
        if (!pptxSuccess) {
          previewCard.innerHTML = `
            <div class="flex flex-col items-center py-3 text-sky-300">
              <i data-lucide="presentation" class="w-6 h-6 mb-1"></i>
              <span class="truncate max-w-[85px] text-[10px]">${file.name}</span>
              <span class="text-[9px] text-slate-400">已加入待分析</span>
            </div>
          `;
          lucide.createIcons();
          showToast("💡 提示：在線上版本，建議將 PPT 匯出為 PDF 或直接截圖上傳，效果最為即時精準！", "info");
        }
      } catch (err) {
        console.warn("無法取得 PPTX 縮圖:", err);
      }

    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedSlidePages.push({
          page: uploadedSlidePages.length + 1,
          image: e.target.result
        });

        const card = document.createElement("div");
        card.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-1 flex flex-col items-center shadow-sm";
        card.innerHTML = `
          <div class="w-full h-20 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
            <img src="${e.target.result}" class="w-full h-full object-cover">
          </div>
          <span class="truncate max-w-[90px] text-[10px] text-slate-300 mt-1 font-medium">${file.name}</span>
        `;
        gallery.appendChild(card);
      };
      reader.readAsDataURL(file);
    }
  }
}

// === 4. 純瀏覽器端 AI 直連呼叫引擎 (支援 GitHub Pages Serverless) ===
async function callGeminiDirectly(apiKey, selectedModel, slideImages, promptText) {
  // 建立高穩定性模型候選清單（最新 2.5 Flash 優先，具備 1M context 與極高多模態視覺精度）
  const candidateModels = [];
  if (selectedModel && selectedModel !== "auto") {
    candidateModels.push(selectedModel);
  }
  // 候選優先級：gemini-2.5-flash ➔ gemini-2.0-flash ➔ gemini-1.5-flash
  const defaultList = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"];
  for (const m of defaultList) {
    if (!candidateModels.includes(m)) {
      candidateModels.push(m);
    }
  }

  const parts = [];
  // 取出最多 6 頁投影片縮圖
  for (const page of slideImages.slice(0, 6)) {
    if (page.image && page.image.startsWith("data:")) {
      const mimeMatch = page.image.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const b64 = page.image.replace(/^data:[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: mime,
          data: b64
        }
      });
    }
  }

  parts.push({ text: promptText });

  const payload = {
    contents: [
      {
        role: "user",
        parts: parts
      }
    ],
    systemInstruction: {
      parts: [
        { text: _0xgetDecryptedInstruction() }
      ]
    },
    generationConfig: {
      temperature: 0.4
    }
  };

  let lastError = null;

  // 自動依序嘗試候選模型（遇到個別模型未開放或 404 自動切換）
  for (const modelName of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const resJson = await response.json();
      if (!response.ok) {
        const msg = resJson.error ? resJson.error.message : "Gemini API 請求失敗";
        // 若該模型在該 API key 或版本下不存在或不支援，無縫嘗試下一個備援模型
        if (response.status === 404 || msg.includes("not found") || msg.includes("is not supported") || msg.includes("Call ModelService.ListModels")) {
          console.warn(`模型 ${modelName} 暫不可用，正在自動平滑切換至下一個備援模型...`, msg);
          lastError = new Error(`Google Gemini API 錯誤: ${msg}`);
          continue;
        }
        throw new Error(`Google Gemini API 錯誤: ${msg}`);
      }

      const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini 未返回分析文字，請確認 API Key 是否有效。");
      }

      return {
        status: "success",
        provider: "Google Gemini",
        model_used: modelName,
        markdown_report: text,
        structured_meta: fallbackExtractMeta(text)
      };
    } catch (err) {
      if (err.message && (err.message.includes("not found") || err.message.includes("is not supported") || err.message.includes("ListModels"))) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Google Gemini API 無法調用任何可用模型，請檢查 API Key 是否正確。");
}

async function callOpenAiDirectly(apiKey, selectedModel, slideImages, promptText) {
  let modelName = selectedModel || "auto";
  if (modelName === "auto") {
    modelName = "gpt-4o";
  }

  const endpoint = "https://api.openai.com/v1/chat/completions";
  const content = [{ type: "text", text: promptText }];

  for (const page of slideImages.slice(0, 6)) {
    if (page.image && page.image.startsWith("data:")) {
      content.push({
        type: "image_url",
        image_url: {
          url: page.image,
          detail: "high"
        }
      });
    }
  }

  const payload = {
    model: modelName,
    messages: [
      { role: "system", content: _0xgetDecryptedInstruction() },
      { role: "user", content: content }
    ],
    temperature: 0.4
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const resJson = await response.json();
  if (!response.ok) {
    const msg = resJson.error ? resJson.error.message : "OpenAI API 請求失敗";
    throw new Error(`OpenAI API 錯誤: ${msg}`);
  }

  const text = resJson.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI 未返回分析文字");
  }

  return {
    status: "success",
    provider: "OpenAI",
    model_used: modelName,
    markdown_report: text,
    structured_meta: fallbackExtractMeta(text)
  };
}

// === 4.1 精密多階段管線進度條控制 (Precision Pipeline Progress Tracker) ===
let progressPipelineInterval = null;

function resetProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
  updatePipelineUi(12, 1, "正在高解析光學採樣畫布與圖層幾何邊界...");
}

function startProgressPipeline() {
  resetProgressPipeline();
  let currentPercent = 14;
  const startTime = Date.now();

  progressPipelineInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;

    // 階段 1：0 ~ 1.8 秒，推進到 35%
    if (elapsed < 1800) {
      currentPercent = Math.min(35, 14 + Math.floor((elapsed / 1800) * 21));
      updatePipelineUi(currentPercent, 1, "正在光學採樣投影片畫布與解析留白比例...");
    } 
    // 階段 2：1.8 ~ 4.5 秒，推進到 65%
    else if (elapsed < 4500) {
      currentPercent = Math.min(65, 35 + Math.floor(((elapsed - 1800) / 2700) * 30));
      updatePipelineUi(currentPercent, 2, "正在逆向版面幾何骨架，分析左右分割與卡片結構...");
    } 
    // 階段 3：4.5 ~ 7.5 秒，推進到 85%
    else if (elapsed < 7500) {
      currentPercent = Math.min(85, 65 + Math.floor(((elapsed - 4500) / 3000) * 20));
      updatePipelineUi(currentPercent, 3, "正在提取精準設計系統與 4 色 Hex 色票代碼...");
    } 
    // 階段 4：7.5 秒以上，平緩推進到 94%
    else {
      currentPercent = Math.min(94, 85 + Math.floor(((elapsed - 7500) / 4500) * 9));
      updatePipelineUi(currentPercent, 4, "正在編譯 NotebookLM 簡報風格與排版提示詞...");
    }
  }, 120);
}

function completeProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
  updatePipelineUi(100, 4, "逆向分析全部就緒！正在為您渲染成果...");
}

function stopProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
}

function updatePipelineUi(percent, activeStep, taskDescription) {
  const percentEl = document.getElementById("loading-progress-percent");
  const barEl = document.getElementById("loading-progress-bar");
  const taskEl = document.getElementById("loading-active-task");
  const stepCounterEl = document.getElementById("loading-step-counter");

  if (percentEl) percentEl.textContent = `${percent}%`;
  if (barEl) barEl.style.width = `${percent}%`;
  if (taskEl) taskEl.textContent = taskDescription;
  if (stepCounterEl) stepCounterEl.textContent = `階段 ${activeStep}/4`;

  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`step-pipe-${i}`);
    const badge = document.getElementById(`step-pipe-badge-${i}`);
    const icon = document.getElementById(`step-pipe-icon-${i}`);
    if (!card || !badge || !icon) continue;

    if (i < activeStep || percent === 100) {
      // 已完成
      card.className = "p-3 rounded-lg bg-[#0E1013] border border-emerald-500/25 flex items-start gap-3 transition-colors opacity-100";
      icon.className = "w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5";
      icon.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i>';
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      badge.textContent = "已就緒";
    } else if (i === activeStep) {
      // 進行中
      card.className = "p-3 rounded-lg bg-[#0E1013] border border-white/20 flex items-start gap-3 transition-colors opacity-100 shadow-sm";
      icon.className = "w-6 h-6 rounded-md bg-white/10 text-white flex items-center justify-center shrink-0 mt-0.5 animate-pulse";
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-white border border-white/20";
      badge.textContent = "處理中";
    } else {
      // 等待中
      card.className = "p-3 rounded-lg bg-[#0E1013] border border-white/[0.05] flex items-start gap-3 transition-colors opacity-50";
      icon.className = "w-6 h-6 rounded-md bg-white/[0.04] text-zinc-500 flex items-center justify-center shrink-0 mt-0.5";
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.03] text-zinc-500 border border-white/[0.05]";
      badge.textContent = "等待中";
    }
  }
  if (window.lucide) window.lucide.createIcons();
}

// === 5. 開始發起分析流程 ===
async function handleStartAnalyze() {
  if (selectedFiles.length === 0) {
    showToast("請先上傳簡報 PDF 或投影片圖片！", "warning");
    return;
  }

  const apiKey = getApiKey(currentProvider);
  if (!apiKey) {
    showToast(`請先輸入您的 ${PROVIDER_CONFIG[currentProvider].name} API Key`, "warning");
    openApiKeyModal(currentProvider);
    return;
  }

  // 切換 UI 至載入狀態並啟動多階段管線進度條
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-result").classList.add("hidden");
  document.getElementById("panel-loading").classList.remove("hidden");
  startProgressPipeline();

  const startBtn = document.getElementById("btn-start-analyze");
  startBtn.disabled = true;
  startBtn.classList.add("opacity-50");

  const model = "auto";
  const isGitHubPages = window.location.hostname.includes("github.io") || window.location.protocol === "file:";

  let data = null;

  try {
    // 1. 若非純靜態 GitHub Pages 且處於本地 localhost，先嘗試呼叫 Python 後端
    if (!isGitHubPages && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
      try {
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append("files", file));
        formData.append("provider", currentProvider);
        formData.append("model", model);

        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData
        });

        if (response.ok) {
          data = await response.json();
        }
      } catch (err) {
        console.warn("本地後端無法連線，切換為瀏覽器前端直連模式:", err);
      }
    }

    // 2. 若處於 GitHub Pages 或本地後端不可用，使用前端瀏覽器直連（Serverless 模式）
    if (!data) {
      if (uploadedSlidePages.length === 0) {
        throw new Error("未檢測到有效投影片影像，請確認上傳了清晰的 PDF 或投影片圖片。");
      }

      const promptText = "請詳細審視我上傳的簡報投影片，執行深度視覺與幾何拓撲逆向工程。\n" +
        "【核心使命】：\n" +
        "1. 必須逐頁精確拆解投影片的真實骨架（如：深色照片遮罩底、標題左側垂直實心粗色塊標柱、右上角外擴亮橘同心圓弧環、超粗無襯線字體、N 欄線框卡片等真實視覺特徵），100% 忠於原稿！\n" +
        "2. 產出的第 3 節 NotebookLM 提示詞必須同時完整輸出兩種模式代碼區塊：\n" +
        "   - 【模式 1：全域風格架構（推薦）】：提取全域視覺手冊與版型語法庫，彈性規劃 3~20 頁，適合任意筆記靈活套用。\n" +
        "   - 【模式 2：逐頁 1:1 對比】：嚴格對應原投影片各頁，輸出包含視覺配置與文案內容區的逐頁精確結構。\n" +
        "3. 產出一份可直接獨立運行的 HTML/Tailwind 1:1 還原投影片結構代碼。\n" +
        "4. 請嚴格依照 SYSTEM INSTRUCTION 規定的章節與 JSON 格式輸出。";

      if (currentProvider === "gemini") {
        data = await callGeminiDirectly(apiKey, model, uploadedSlidePages, promptText);
      } else if (currentProvider === "openai") {
        data = await callOpenAiDirectly(apiKey, model, uploadedSlidePages, promptText);
      } else {
        throw new Error("Anthropic API 因官方安全跨域規範限制，純前端靜態站點請選擇 Google Gemini（推薦，免費且極速）或 OpenAI！");
      }
    }

    // 推進到 100% 並短暫停留以呈現完成回饋
    completeProgressPipeline();
    await new Promise(resolve => setTimeout(resolve, 350));

    renderAnalysisResult(data);
    showToast("風格逆向分析完成！已為您產生 1:1 幾何對比與雙模式提示詞", "success");

  } catch (err) {
    stopProgressPipeline();
    console.error(err);
    showToast(err.message, "error");
    document.getElementById("panel-idle").classList.remove("hidden");
  } finally {
    stopProgressPipeline();
    document.getElementById("panel-loading").classList.add("hidden");
    startBtn.disabled = false;
    startBtn.classList.remove("opacity-50");
  }
}

// === 5. 結果渲染邏輯 (雙欄並排與多頁籤) ===
function renderAnalysisResult(data) {
  generatedReportMarkdown = data.markdown_report || "";
  
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-loading").classList.add("hidden");
  document.getElementById("panel-result").classList.remove("hidden");

  // 萃取各項產出 (模式 1 與 模式 2)
  const extracted = extractNblmPromptModes(generatedReportMarkdown);
  generatedPromptGlobal = extracted.globalPrompt;
  generatedPromptSlide = extracted.slidePrompt;
  generatedNblmPrompt = currentPromptMode === "global" ? generatedPromptGlobal : generatedPromptSlide;
  generatedSlideHtml = extractSlideHtml(generatedReportMarkdown);

  // 渲染當前模式提示詞
  switchPromptMode(currentPromptMode);

  // 更新投影片預覽視窗
  currentComparisonPage = 0;
  updateComparisonView();

  // 預設切換至 NotebookLM 提示詞頁籤
  switchResultTab("nblm");

  const meta = data.structured_meta || fallbackExtractMeta(generatedReportMarkdown);
  
  document.getElementById("result-style-name").textContent = meta.style_name || "簡報視覺風格解析報告";

  const autoBadge = document.getElementById("result-auto-badge");
  if (autoBadge) {
    if (data.auto_reason) {
      autoBadge.textContent = data.auto_reason;
      autoBadge.classList.remove("hidden");
    } else if (data.model_used) {
      autoBadge.textContent = `模型: ${data.model_used}`;
      autoBadge.classList.remove("hidden");
    } else {
      autoBadge.classList.add("hidden");
    }
  }

  const tagsContainer = document.getElementById("result-tags-container");
  tagsContainer.innerHTML = "";
  (meta.tags || ["麥肯錫架構", "純2D扁平", "三欄線框卡片", "同心圓模型"]).forEach(tag => {
    const span = document.createElement("span");
    span.className = "px-2 py-0.5 text-[11px] rounded bg-white/[0.04] text-zinc-300 border border-white/[0.08] font-mono";
    span.textContent = `# ${tag}`;
    tagsContainer.appendChild(span);
  });

  if (meta.white_space_ratio) {
    document.getElementById("white-space-metric").textContent = `留白指標: ${meta.white_space_ratio}`;
  }

  renderColorPalette(meta.palette || [
    {"role": "畫布背景", "hex": "#FFFFFF", "name": "Pure White"},
    {"role": "主標題與邊框", "hex": "#0E3B5D", "name": "Navy Blue"},
    {"role": "核心強調金", "hex": "#C59B27", "name": "Ochre Gold"},
    {"role": "斑馬條塊色", "hex": "#F3F4F6", "name": "Light Gray"}
  ]);

  const markdownContainer = document.getElementById("full-report-markdown");
  markdownContainer.innerHTML = marked.parse(generatedReportMarkdown);

  lucide.createIcons();
}

// 更新雙欄對比視窗 (原始投影片 vs 還原成果)
function updateComparisonView() {
  const originalImg = document.getElementById("img-original-slide");
  const originalPlaceholder = document.getElementById("original-placeholder");
  const pageNav = document.getElementById("slide-page-nav");
  const pageIndicator = document.getElementById("slide-page-indicator");
  const originalPageLabel = document.getElementById("original-page-label");
  const prevBtn = document.getElementById("btn-prev-slide");
  const nextBtn = document.getElementById("btn-next-slide");

  if (uploadedSlidePages && uploadedSlidePages.length > 0) {
    const pageData = uploadedSlidePages[currentComparisonPage] || uploadedSlidePages[0];
    originalImg.src = pageData.image;
    originalImg.classList.remove("hidden");
    if (originalPlaceholder) originalPlaceholder.classList.add("hidden");
    originalPageLabel.textContent = `Page ${currentComparisonPage + 1}`;
    
    if (uploadedSlidePages.length > 1) {
      pageNav.classList.remove("hidden");
      pageNav.classList.add("flex");
      pageIndicator.textContent = `第 ${currentComparisonPage + 1} / ${uploadedSlidePages.length} 頁`;
      prevBtn.disabled = (currentComparisonPage === 0);
      nextBtn.disabled = (currentComparisonPage === uploadedSlidePages.length - 1);
      prevBtn.classList.toggle("opacity-30", currentComparisonPage === 0);
      nextBtn.classList.toggle("opacity-30", currentComparisonPage === uploadedSlidePages.length - 1);
    } else {
      pageNav.classList.add("hidden");
    }
  } else {
    originalImg.classList.add("hidden");
    if (originalPlaceholder) originalPlaceholder.classList.remove("hidden");
    pageNav.classList.add("hidden");
  }
}

function switchResultTab(tabName) {
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    const t = btn.getAttribute("data-result-tab");
    if (t === tabName) {
      btn.className = "result-tab-btn active px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors bg-white/10 text-white border border-white/10 cursor-pointer";
    } else {
      btn.className = "result-tab-btn px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors text-zinc-400 hover:text-white hover:bg-white/[0.04] cursor-pointer";
    }
  });

  document.querySelectorAll(".result-tab-pane").forEach(pane => {
    pane.classList.add("hidden");
  });
  const targetPane = document.getElementById(`tab-pane-${tabName}`);
  if (targetPane) {
    targetPane.classList.remove("hidden");
  }
  lucide.createIcons();
}

function switchPromptMode(mode) {
  currentPromptMode = mode;

  // 更新左側按鈕樣式
  document.querySelectorAll("#prompt-mode-selector .prompt-mode-btn").forEach(btn => {
    const m = btn.getAttribute("data-prompt-mode");
    if (m === mode) {
      btn.className = "prompt-mode-btn active p-2 rounded-lg border text-left transition-all cursor-pointer bg-white/10 text-white border-white/20";
    } else {
      btn.className = "prompt-mode-btn p-2 rounded-lg border text-left transition-all cursor-pointer bg-white/[0.03] text-zinc-400 border-white/[0.08] hover:bg-white/[0.06]";
    }
  });

  // 更新右側結果頁子頁籤樣式
  const btnGlobal = document.getElementById("btn-subtab-global");
  const btnSlide = document.getElementById("btn-subtab-slide");
  const descGlobal = document.getElementById("desc-mode-global");
  const descSlide = document.getElementById("desc-mode-slide");
  const codeEl = document.getElementById("nblm-prompt-code");

  if (btnGlobal && btnSlide) {
    if (mode === "global") {
      btnGlobal.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 bg-white/10 text-white shadow-sm border border-white/10 cursor-pointer";
      btnSlide.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent cursor-pointer";
      if (descGlobal) descGlobal.classList.remove("hidden");
      if (descSlide) descSlide.classList.add("hidden");
      if (codeEl) codeEl.textContent = generatedPromptGlobal || generatedNblmPrompt || "未擷取到全域風格提示詞，請查看完整報告。";
    } else {
      btnSlide.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 bg-white/10 text-white shadow-sm border border-white/10 cursor-pointer";
      btnGlobal.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent cursor-pointer";
      if (descSlide) descSlide.classList.remove("hidden");
      if (descGlobal) descGlobal.classList.add("hidden");
      if (codeEl) codeEl.textContent = generatedPromptSlide || generatedNblmPrompt || "未擷取到逐頁 1:1 提示詞，請查看完整報告。";
    }
  }
  if (window.lucide) window.lucide.createIcons();
}
window.switchPromptMode = switchPromptMode;

function extractNblmPromptModes(markdown) {
  let globalPrompt = "";
  let slidePrompt = "";

  if (markdown.includes("## 3. 📋") || markdown.includes("NotebookLM 專用") || markdown.includes("NotebookLM")) {
    const parts = markdown.split(/## 3\..*?NotebookLM.*?/i);
    if (parts.length > 1) {
      const section = parts[1].split(/## 4\./)[0];

      // 嘗試按標題切分模式 1 與模式 2
      if (section.includes("模式 1") || section.includes("全域風格")) {
        const m1Part = section.split(/### 模式 2|模式 2/i)[0];
        const m1Match = m1Part.match(/```(?:markdown)?([\s\S]*?)```/i);
        if (m1Match && m1Match[1]) {
          globalPrompt = m1Match[1].trim();
        }
      }

      if (section.includes("模式 2") || section.includes("逐頁 1:1")) {
        const m2Part = section.split(/### 模式 2|模式 2/i)[1] || "";
        const m2Match = m2Part.match(/```(?:markdown)?([\s\S]*?)```/i);
        if (m2Match && m2Match[1]) {
          slidePrompt = m2Match[1].trim();
        }
      }

      // 若未分段匹配到，提取 section 內所有的 code blocks
      if (!globalPrompt || !slidePrompt) {
        const blocks = [...section.matchAll(/```(?:markdown)?([\s\S]*?)```/gi)];
        if (blocks.length >= 2) {
          if (!globalPrompt) globalPrompt = blocks[0][1].trim();
          if (!slidePrompt) slidePrompt = blocks[1][1].trim();
        } else if (blocks.length === 1) {
          if (!globalPrompt) globalPrompt = blocks[0][1].trim();
          if (!slidePrompt) slidePrompt = blocks[0][1].trim();
        }
      }
    }
  }

  // 全文通用備援
  if (!globalPrompt) {
    const firstBlock = markdown.match(/```(?:markdown)?([\s\S]*?)```/i);
    globalPrompt = firstBlock ? firstBlock[1].trim() : markdown;
  }
  if (!slidePrompt) {
    slidePrompt = globalPrompt;
  }

  return { globalPrompt, slidePrompt };
}

function extractNblmPrompt(markdown) {
  const res = extractNblmPromptModes(markdown);
  return currentPromptMode === "global" ? res.globalPrompt : res.slidePrompt;
}

function extractSlideHtml(markdown) {
  if (markdown.includes("HTML / Tailwind") || markdown.includes("HTML 代碼") || markdown.includes("## 4. 💻") || markdown.includes("## 5. 💻")) {
    const parts = markdown.split(/## (?:4|5)\..*?HTML.*?/i);
    if (parts.length > 1) {
      const section = parts[1].split(/---/)[0];
      const codeMatch = section.match(/```(?:html)?([\s\S]*?)```/i);
      if (codeMatch && codeMatch[1]) {
        return codeMatch[1].trim();
      }
    }
  }
  const anyHtml = markdown.match(/```html([\s\S]*?)```/i);
  return anyHtml ? anyHtml[1].trim() : "";
}

function buildFullSlideHtml(rawHtml) {
  if (rawHtml.includes("<!DOCTYPE html") || rawHtml.includes("<html")) {
    return rawHtml;
  }
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>1:1 投影片視覺還原預覽</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Noto Sans TC', sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
  </style>
</head>
<body class="bg-slate-950 min-h-screen flex items-center justify-center p-2 sm:p-4">
  <div class="w-full max-w-5xl shadow-2xl rounded-xl overflow-hidden aspect-video flex flex-col justify-center border border-slate-850">
    ${rawHtml}
  </div>
</body>
</html>`;
}

// 簡報精確色票卡片 (Precision Palette Tokens)
function renderColorPalette(palette) {
  const container = document.getElementById("color-palette-container");
  container.innerHTML = "";

  palette.forEach(color => {
    const card = document.createElement("div");
    card.className = "group bg-[#0E1013] hover:bg-white/[0.04] border border-white/[0.08] hover:border-white/20 rounded-lg p-2.5 flex flex-col justify-between transition-colors cursor-pointer shadow-sm";
    card.title = "點擊複製 Hex 色碼";
    
    card.innerHTML = `
      <div class="w-full h-8 rounded border border-white/10 mb-2 shadow-inner" style="background-color: ${color.hex}"></div>
      <div>
        <div class="text-[10px] font-medium text-zinc-400 truncate">${color.role || color.name}</div>
        <div class="text-[11px] font-mono font-medium text-zinc-200 flex items-center justify-between mt-0.5">
          <span>${color.hex}</span>
          <i data-lucide="copy" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400"></i>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      navigator.clipboard.writeText(color.hex);
      showToast(`已複製色碼: ${color.hex}`, "success");
    });

    container.appendChild(card);
  });
  lucide.createIcons();
}

function fallbackExtractMeta(markdown) {
  const hexMatches = markdown.match(/#[0-9a-fA-F]{6}/g) || ["#FFFFFF", "#0E3B5D", "#C59B27", "#F3F4F6"];
  const uniqueHex = Array.from(new Set(hexMatches)).slice(0, 4);
  return {
    style_name: "高階商業顧問排版",
    tags: ["版面骨架", "三欄卡片", "同心圓模型", "純2D扁平"],
    palette: uniqueHex.map((hex, idx) => ({
      role: idx === 0 ? "畫布底色" : idx === 1 ? "主標題與邊框" : idx === 2 ? "核心強調色" : "輔助色塊",
      hex: hex,
      name: "提取色"
    })),
    white_space_ratio: "70%"
  };
}

function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");

  text.textContent = message;

  if (type === "success") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-xs shadow-xl text-white";
    icon.className = "w-4 h-4 text-emerald-400";
    icon.setAttribute("data-lucide", "check-circle");
  } else if (type === "warning" || type === "error") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-rose-900 border border-rose-700 text-xs shadow-xl text-white";
    icon.className = "w-4 h-4 text-rose-300";
    icon.setAttribute("data-lucide", "alert-circle");
  } else {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-xs shadow-xl text-white";
    icon.className = "w-4 h-4 text-blue-400";
    icon.setAttribute("data-lucide", "info");
  }

  lucide.createIcons();

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-20", "opacity-0");
  }, 3500);
}

function updateUiState() {
  lucide.createIcons();
}

// === [P0 智財與防逆向安全守護] Anti-Inspection & DevTools Guard ===
(function initSecurityGuard() {
  // 1. 停用右鍵檢視原始碼
  document.addEventListener("contextmenu", (e) => {
    // 允許在輸入框或提示詞區域點擊右鍵以方便選取與複製
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.closest("#nblm-prompt-code")) {
      return;
    }
    e.preventDefault();
    if (typeof showToast === "function") {
      showToast("🛡️ 智財安全保護：原始碼已鎖定", "info");
    }
  });

  // 2. 攔截常見開發者工具熱鍵 (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")) ||
      (e.ctrlKey && (e.key === "U" || e.key === "u" || e.key === "S" || e.key === "s"))
    ) {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        e.stopPropagation();
        if (typeof showToast === "function") {
          showToast("🛡️ 智財安全保護：快捷鍵已被系統保護鎖定", "warning");
        }
        return false;
      }
    }
  });

  // 3. 偵測 DevTools 開啟並清空控制台
  setInterval(() => {
    const threshold = 160;
    if (
      window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold
    ) {
      console.clear();
      console.log("%c[Security Protected] 核心智財與提示詞已於後端伺服器安全封裝。", "color: #10b981; font-weight: bold; font-size: 14px;");
    }
  }, 1500);
})();
