package uk.telly.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The same palette and the same shapes as the web app's redesign, so the
 * server screens look like part of Telly rather than a form bolted on.
 */
object T {
    val Ink = Color(0xFF06070A)
    val Panel = Color(0xFF12151C)
    val Line = Color(0xFF262C36)
    val Txt = Color(0xFFF3F5F9)
    val Dim = Color(0xFF9AA5B4)
    val Faint = Color(0xFF6D7787)
    val Gold = Color(0xFFE7C17A)
    val GoldSoft = Color(0x29E7C17A)
    val Bad = Color(0xFFFF6B78)
    val Ok = Color(0xFF4ADE80)
}

/** A label in the house style: small, wide-tracked, quiet. */
@Composable
fun Eyebrow(text: String, color: Color = T.Gold) {
    Text(text.uppercase(), color = color, fontSize = 12.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Bold)
}

@Composable
fun Title(text: String, size: Int = 34) {
    Text(text, color = T.Txt, fontSize = size.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)
}

@Composable
fun Body(text: String, color: Color = T.Dim, size: Int = 15) {
    Text(text, color = color, fontSize = size.sp, lineHeight = (size * 1.5).sp)
}

/**
 * A field big enough for a television and obvious when it has the remote's
 * attention: the border lights, rather than a hairline cursor being the only
 * clue from across a room.
 */
@Composable
fun TvField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    hint: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    modifier: Modifier = Modifier
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(modifier) {
        Eyebrow(label, if (focused) T.Gold else T.Faint)
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(if (focused) T.GoldSoft else T.Panel)
                .border(if (focused) 2.dp else 1.dp, if (focused) T.Gold else T.Line, RoundedCornerShape(16.dp))
                .padding(horizontal = 20.dp, vertical = 18.dp)
        ) {
            if (value.isEmpty() && hint.isNotEmpty()) Text(hint, color = T.Faint, fontSize = 18.sp)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                interactionSource = interaction,
                textStyle = TextStyle(color = T.Txt, fontSize = 18.sp),
                cursorBrush = SolidColor(T.Gold),
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
                visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

/** Buttons that grow and glow on focus, so a remote user can see where they are. */
@Composable
fun TvButton(
    label: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    enabled: Boolean = true,
    busy: Boolean = false,
    onClick: () -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val background = when {
        !enabled -> T.Panel
        primary && focused -> T.Gold
        primary -> T.Gold.copy(alpha = 0.85f)
        focused -> T.GoldSoft
        else -> T.Panel
    }
    val content = when {
        !enabled -> T.Faint
        primary -> T.Ink
        focused -> T.Gold
        else -> T.Dim
    }
    Box(
        modifier
            .heightIn(min = 60.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(
                BorderStroke(if (focused) 2.dp else 1.dp, if (focused) T.Gold else T.Line),
                RoundedCornerShape(999.dp)
            )
            .focusable(enabled, interaction)
            .clickable(enabled = enabled && !busy, interactionSource = interaction, indication = null) { onClick() }
            .padding(horizontal = 32.dp, vertical = 16.dp),
        contentAlignment = Alignment.Center
    ) {
        if (busy) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(color = content, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(12.dp))
                Text(label, color = content, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
        } else {
            Text(label, color = content, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** Trouble, said once, in words: never a status code on a television. */
@Composable
fun Notice(message: String, kind: NoticeKind = NoticeKind.Bad, modifier: Modifier = Modifier) {
    val colour = when (kind) {
        NoticeKind.Bad -> T.Bad
        NoticeKind.Good -> T.Ok
        NoticeKind.Info -> T.Dim
    }
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(colour.copy(alpha = 0.10f))
            .border(1.dp, colour.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(message, color = colour, fontSize = 15.sp, lineHeight = 22.sp)
    }
}

enum class NoticeKind { Bad, Good, Info }
