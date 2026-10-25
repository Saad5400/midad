// ISO 32000-1, Annex D: predefined character encodings.
const macRoman = [
    'Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring',
    'ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve',
    'ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet',
    'paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus',
    'lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae',
    'oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright',
    'ellipsis space Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide',
    'lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered',
    'quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex',
    'Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron',
    'breve dotaccent ring cedilla hungarumlaut ogonek caron',
]
    .join(' ')
    .split(' ');

const macExpert = [
    '32:space 33:exclamsmall 34:Hungarumlautsmall 35:centoldstyle 36:dollaroldstyle 37:dollarsuperior',
    '38:ampersandsmall 39:Acutesmall 40:parenleftsuperior 41:parenrightsuperior 42:twodotenleader 43:onedotenleader',
    '44:comma 45:hyphen 46:period 47:fraction 48:zerooldstyle 49:oneoldstyle 50:twooldstyle 51:threeoldstyle',
    '52:fouroldstyle 53:fiveoldstyle 54:sixoldstyle 55:sevenoldstyle 56:eightoldstyle 57:nineoldstyle 58:colon',
    '59:semicolon 61:threequartersemdash 63:questionsmall 68:Ethsmall 71:onequarter 72:onehalf 73:threequarters',
    '74:oneeighth 75:threeeighths 76:fiveeighths 77:seveneighths 78:onethird 79:twothirds 86:ff 87:fi 88:fl 89:ffi',
    '90:ffl 91:parenleftinferior 93:parenrightinferior 94:Circumflexsmall 95:hypheninferior 96:Gravesmall 97:Asmall',
    '98:Bsmall 99:Csmall 100:Dsmall 101:Esmall 102:Fsmall 103:Gsmall 104:Hsmall 105:Ismall 106:Jsmall 107:Ksmall',
    '108:Lsmall 109:Msmall 110:Nsmall 111:Osmall 112:Psmall 113:Qsmall 114:Rsmall 115:Ssmall 116:Tsmall 117:Usmall',
    '118:Vsmall 119:Wsmall 120:Xsmall 121:Ysmall 122:Zsmall 123:colonmonetary 124:onefitted 125:rupiah',
    '126:Tildesmall 129:asuperior 130:centsuperior 135:Aacutesmall 136:Agravesmall 137:Acircumflexsmall',
    '138:Adieresissmall 139:Atildesmall 140:Aringsmall 141:Ccedillasmall 142:Eacutesmall 143:Egravesmall',
    '144:Ecircumflexsmall 145:Edieresissmall 146:Iacutesmall 147:Igravesmall 148:Icircumflexsmall',
    '149:Idieresissmall 150:Ntildesmall 151:Oacutesmall 152:Ogravesmall 153:Ocircumflexsmall 154:Odieresissmall',
    '155:Otildesmall 156:Uacutesmall 157:Ugravesmall 158:Ucircumflexsmall 159:Udieresissmall 161:eightsuperior',
    '162:fourinferior 163:threeinferior 164:sixinferior 165:eightinferior 166:seveninferior 167:Scaronsmall',
    '169:centinferior 170:twoinferior 172:Dieresissmall 174:Caronsmall 175:osuperior 176:fiveinferior',
    '178:commainferior 179:periodinferior 180:Yacutesmall 182:dollarinferior 185:Thornsmall 187:nineinferior',
    '188:zeroinferior 189:Zcaronsmall 190:AEsmall 191:Oslashsmall 192:questiondownsmall 193:oneinferior',
    '194:Lslashsmall 201:Cedillasmall 207:OEsmall 208:figuredash 209:hyphensuperior 214:exclamdownsmall',
    '216:Ydieresissmall 218:onesuperior 219:twosuperior 220:threesuperior 221:foursuperior 222:fivesuperior',
    '223:sixsuperior 224:sevensuperior 225:ninesuperior 226:zerosuperior 228:esuperior 229:rsuperior 230:tsuperior',
    '233:isuperior 234:ssuperior 235:dsuperior 241:lsuperior 242:Ogoneksmall 243:Brevesmall 244:Macronsmall',
    '245:bsuperior 246:nsuperior 247:msuperior 248:commasuperior 249:periodsuperior 250:Dotaccentsmall',
    '251:Ringsmall',
]
    .join(' ')
    .split(' ');

export function macSourceEncoding(name: string, ansi: readonly string[]): string[] | undefined {
    const result = new Array<string>(256).fill('.notdef');
    if (name === 'MacRomanEncoding') {
        for (let code = 32; code <= 126; code++) result[code] = ansi[code];
        macRoman.forEach((glyph, index) => {
            result[index + 128] = glyph;
        });
    } else if (name === 'MacExpertEncoding') {
        for (const entry of macExpert) {
            const [code, glyph] = entry.split(':');
            result[Number(code)] = glyph;
        }
    } else return undefined;
    return result;
}
